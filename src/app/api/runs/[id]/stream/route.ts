import { NextRequest } from "next/server";
import { runManager } from "@/lib/agent";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: runId } = await params;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let dbSyncTimer: NodeJS.Timeout | null = null;
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: any) => {
        if (isClosed) return;
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch (_) {
          isClosed = true;
        }
      };

      // Send initial connection comment
      sendEvent("connected", { runId, connectedAt: new Date().toISOString() });

      // Keep-alive heartbeat ping every 15s
      const keepAliveTimer = setInterval(() => {
        if (isClosed) {
          clearInterval(keepAliveTimer);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch (_) {
          isClosed = true;
          clearInterval(keepAliveTimer);
        }
      }, 15000);

      // 1. Subscribe to in-process memory emitter (instant zero-latency for co-located runs)
      unsubscribe = runManager.subscribe(runId, (event: string, data: any) => {
        sendEvent(event, data);

        if (event === "done") {
          isClosed = true;
          clearInterval(keepAliveTimer);
          if (dbSyncTimer) clearInterval(dbSyncTimer);
          setTimeout(() => {
            try {
              controller.close();
            } catch (_) {}
          }, 100);
        }
      });

      // 2. Database Sync Loop: bridges across serverless lambda containers
      const knownToolStarts = new Set<string>();
      const knownToolEnds = new Set<string>();
      let hasEmittedTerminal = false;

      const checkDbState = async () => {
        if (isClosed || hasEmittedTerminal) return;
        try {
          const run = await prisma.agentRun.findUnique({
            where: { id: runId },
            include: {
              toolInvocations: true,
              waitpoints: { where: { status: "pending" } },
              message: true,
            },
          });

          if (!run) return;

          // Stream any tools found in database
          for (const ti of run.toolInvocations) {
            if (!knownToolStarts.has(ti.id)) {
              knownToolStarts.add(ti.id);
              sendEvent("tool_start", {
                toolCallId: ti.id,
                name: ti.toolName,
                input: ti.input,
              });
            }
            if ((ti.status === "completed" || ti.status === "failed") && !knownToolEnds.has(ti.id)) {
              knownToolEnds.add(ti.id);
              sendEvent("tool_end", {
                toolCallId: ti.id,
                name: ti.toolName,
                output: ti.output,
                creditsCost: ti.creditsCost,
                durationMs: ti.executionTimeMs || 0,
              });
            }
          }

          // Stream pending waitpoints
          for (const wp of run.waitpoints) {
            sendEvent("waitpoint", {
              runId: run.id,
              token: wp.token,
              payload: wp.payload,
            });
          }

          // Stream terminal completion if finished in DB
          if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
            hasEmittedTerminal = true;
            sendEvent("status", { status: run.status });
            sendEvent("done", {
              runId: run.id,
              status: run.status,
              messageId: run.messageId,
            });
            isClosed = true;
            clearInterval(keepAliveTimer);
            if (dbSyncTimer) clearInterval(dbSyncTimer);
            setTimeout(() => {
              try {
                controller.close();
              } catch (_) {}
            }, 100);
          }
        } catch (_) {
          // Ignore transient DB query errors
        }
      };

      // Run initial DB check immediately, then poll every 1500ms
      await checkDbState();
      dbSyncTimer = setInterval(checkDbState, 1500);
    },
    cancel() {
      isClosed = true;
      if (unsubscribe) {
        unsubscribe();
      }
      if (dbSyncTimer) {
        clearInterval(dbSyncTimer);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
