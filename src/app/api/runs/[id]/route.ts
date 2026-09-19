import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: runId } = await params;
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        message: true,
        toolInvocations: true,
        runSkills: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(run);
  } catch (error: any) {
    console.error("GET /api/runs/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }
}
