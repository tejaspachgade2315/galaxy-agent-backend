import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runManager } from "@/lib/agent";

interface RouteParams {
  params: Promise<{ id: string; token: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: runId, token } = await params;
    const body = await req.json().catch(() => ({}));
    const { approved = true, response: userResponse = null } = body;

    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: { chat: true },
    });

    if (!run || run.chat.userId !== user.id) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const waitpoint = await prisma.waitpoint.findFirst({
      where: { token, runId },
    });

    if (!waitpoint) {
      return NextResponse.json({ error: "Waitpoint not found" }, { status: 404 });
    }

    // Idempotency: tolerate duplicate submissions safely
    if (waitpoint.status === "resolved") {
      return NextResponse.json({
        success: true,
        status: "resolved",
        alreadyResolved: true,
        waitpoint,
      });
    }

    if (waitpoint.status === "expired" || (waitpoint.expiresAt && waitpoint.expiresAt < new Date())) {
      await prisma.waitpoint.update({
        where: { id: waitpoint.id },
        data: { status: "expired" },
      });
      return NextResponse.json({ error: "Waitpoint has expired" }, { status: 410 });
    }

    // Update waitpoint in database
    const updatedWaitpoint = await prisma.waitpoint.update({
      where: { id: waitpoint.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
        response: { approved, ...(userResponse ? { details: userResponse } : {}) },
      },
    });

    // Notify agent runManager and SSE listeners
    runManager.resolveWaitpoint(token, { approved, response: userResponse });
    runManager.emit(runId, "waitpoint_resolved", {
      token,
      approved,
      status: "resolved",
    });

    return NextResponse.json({
      success: true,
      status: "resolved",
      waitpoint: updatedWaitpoint,
    });
  } catch (error: any) {
    console.error("POST /api/runs/[id]/waitpoints/[token]/resolve error:", error);
    return NextResponse.json({ error: "Failed to resolve waitpoint" }, { status: 500 });
  }
}
