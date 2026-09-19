import { NextRequest } from "next/server";
import { runManager } from "@/lib/agent";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: runId } = await params;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection comment
      controller.enqueue(encoder.encode(`: connected to run ${runId}\n\n`));

      // Keep-alive heartbeat ping every 15s so connection remains stable during long tool execution
      const keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch (_) {}
      }, 15000);

      unsubscribe = runManager.subscribe(runId, (event: string, data: any) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));

          if (event === "done") {
            clearInterval(keepAliveTimer);
            setTimeout(() => {
              try {
                controller.close();
              } catch (_) {}
            }, 100);
          }
        } catch (err) {
          // Stream might have been closed by client
          clearInterval(keepAliveTimer);
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
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
