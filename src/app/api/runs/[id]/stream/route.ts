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
      let hasReceivedInMemoryEvent = false;

      unsubscribe = runManager.subscribe(runId, (event: string, data: any) => {
        hasReceivedInMemoryEvent = true;
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

      // 2. Database Sync Fallback: ONLY activates if no in-memory events arrive within 3s
      //    This means we're on a different serverless container from the execution.
      //    We do NOT run both simultaneously because ti.id (DB primary key) ≠ tc.id (OpenRouter tool call ID),
      //    which causes the frontend to display duplicate tool cards.
      let hasEmittedTerminal = false;
      const knownToolStarts = new Set<string>();
      const knownToolEnds = new Set<string>();

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

          // Emit thinking from the persisted message content
          if (run.message) {
            const blocks = Array.isArray(run.message.content) ? (run.message.content as any[]) : [];
            const thinkingBlock = blocks.find((b: any) => b.type === "thinking");
            if (thinkingBlock?.thinking && thinkingBlock.thinking !== "Preparing response...") {
              sendEvent("thinking_sync", { text: thinkingBlock.thinking });
            }
          }

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

      // Wait 3 seconds, then check: if no in-memory events have arrived, activate DB polling as fallback
      setTimeout(() => {
        if (!hasReceivedInMemoryEvent && !isClosed) {
          // We're on a different serverless container — enable DB polling
          checkDbState();
          dbSyncTimer = setInterval(checkDbState, 1500);
        } else if (!isClosed) {
          // In-memory events are flowing, but still poll for terminal status only (not tools)
          // in case the execution container crashes mid-run
          dbSyncTimer = setInterval(async () => {
            if (isClosed) return;
            try {
              const run = await prisma.agentRun.findUnique({
                where: { id: runId },
                select: { status: true, messageId: true },
              });
              if (run && (run.status === "completed" || run.status === "failed" || run.status === "cancelled")) {
                if (!isClosed) {
                  sendEvent("status", { status: run.status });
                  sendEvent("done", { runId, status: run.status, messageId: run.messageId });
                  isClosed = true;
                  clearInterval(keepAliveTimer);
                  if (dbSyncTimer) clearInterval(dbSyncTimer);
                  setTimeout(() => { try { controller.close(); } catch (_) {} }, 100);
                }
              }
            } catch (_) {}
          }, 5000); // Light polling every 5s just for crash recovery
        }
      }, 3000);
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
