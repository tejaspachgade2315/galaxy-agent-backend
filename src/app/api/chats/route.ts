import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CreateChatInputSchema } from "@/contracts";

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);
    const cursor = searchParams.get("cursor");

    const chats = await prisma.chat.findMany({
      where: { userId: user.id },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    });

    let nextCursor: string | null = null;
    if (chats.length > limit) {
      const nextItem = chats.pop();
      nextCursor = nextItem?.id || null;
    }

    return NextResponse.json({ items: chats, nextCursor });
  } catch (error: any) {
    console.error("GET /api/chats error:", error);
    return NextResponse.json({ error: "Failed to fetch chats" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parse = CreateChatInputSchema.safeParse(body);
    const title = parse.success && parse.data.title ? parse.data.title : "New Chat";

    const chat = await prisma.chat.create({
      data: {
        userId: user.id,
        title,
      },
    });

    return NextResponse.json(chat, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/chats error:", error);
    return NextResponse.json({ error: "Failed to create chat" }, { status: 500 });
  }
}
