import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { runManager } from "@/lib/agent";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: runId } = await params;
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: { chat: true },
    });

    if (!run || run.chat.userId !== user.id) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (run.status === "running" || run.status === "queued") {
      runManager.cancel(runId);
      await prisma.$transaction([
        prisma.agentRun.update({
          where: { id: runId },
          data: { status: "cancelled", completedAt: new Date() },
        }),
        prisma.message.update({
          where: { id: run.messageId },
          data: { status: "cancelled" },
        }),
      ]);
    }

    return NextResponse.json({ success: true, status: "cancelled" });
  } catch (error: any) {
    console.error("POST /api/runs/[id]/cancel error:", error);
    return NextResponse.json({ error: "Failed to cancel run" }, { status: 500 });
  }
}
