import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UpdateChatInputSchema } from "@/contracts";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: chatId } = await params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const cursor = searchParams.get("cursor");

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat || chat.userId !== user.id) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    // Messages cursor pagination
    const messages = await prisma.message.findMany({
      where: { chatId },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      orderBy: { createdAt: "asc" },
      include: {
        attachments: true,
      },
    });

    let nextCursor: string | null = null;
    if (messages.length > limit) {
      const nextItem = messages.pop();
      nextCursor = nextItem?.id || null;
    }

    // Check for any active agent run in this chat
    const activeRun = await prisma.agentRun.findFirst({
      where: { chatId, status: { in: ["queued", "running"] } },
      orderBy: { startedAt: "desc" },
    });

    return NextResponse.json({
      chat,
      messages,
      nextCursor,
      activeRun,
    });
  } catch (error: any) {
    console.error("GET /api/chats/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch chat" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: chatId } = await params;
    const body = await req.json();
    const parse = UpdateChatInputSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json({ error: "Invalid payload", details: parse.error.format() }, { status: 400 });
    }

    const existing = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const updated = await prisma.chat.update({
      where: { id: chatId },
      data: {
        title: parse.data.title !== undefined ? parse.data.title : undefined,
        isPinned: parse.data.isPinned !== undefined ? parse.data.isPinned : undefined,
      },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("PATCH /api/chats/[id] error:", error);
    return NextResponse.json({ error: "Failed to update chat" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: chatId } = await params;
    const existing = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    await prisma.chat.delete({ where: { id: chatId } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/chats/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete chat" }, { status: 500 });
  }
}
