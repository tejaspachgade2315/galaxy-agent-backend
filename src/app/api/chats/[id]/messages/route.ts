import { NextRequest, NextResponse, after } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SendMessageInputSchema } from "@/contracts";
import { runManager } from "@/lib/agent";
import { triggerClient } from "@/lib/trigger";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes execution window for serverless lambdas

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: chatId } = await params;
    const body = await req.json();
    const parse = SendMessageInputSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json({ error: "Invalid message payload", details: parse.error.format() }, { status: 400 });
    }

    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat || chat.userId !== user.id) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    // Check for existing running turn
    const activeRun = await prisma.agentRun.findFirst({
      where: { chatId, status: { in: ["queued", "running", "waiting"] } },
    });

    if (activeRun) {
      // Auto-recover stale lock if run has been active for more than 3 minutes without completion
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
      if (activeRun.startedAt < threeMinutesAgo) {
        await prisma.$transaction([
          prisma.agentRun.update({
            where: { id: activeRun.id },
            data: { status: "failed", errorMessage: "Run timed out (stale lock recovered)", completedAt: new Date() },
          }),
          prisma.message.update({
            where: { id: activeRun.messageId },
            data: { status: "failed", errorMessage: "Execution timed out" },
          }),
        ]);
      } else {
        return NextResponse.json(
          {
            error: "Another agent run is currently active for this chat",
            activeRunId: activeRun.id,
          },
          { status: 409 }
        );
      }
    }

    const { content, model, idempotencyKey: providedKey, attachmentIds, planMode } = parse.data;
    const idempotencyKey = providedKey || `run_${chatId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Create user message, assistant message placeholder, and agent run in single transaction
    const [userMessage, assistantMessage, agentRun] = await prisma.$transaction(async (tx) => {
      const uMsg = await tx.message.create({
        data: {
          chatId,
          role: "user",
          content: [{ type: "text", text: content }],
          status: "completed",
        },
      });

      if (attachmentIds && attachmentIds.length > 0) {
        await tx.attachment.updateMany({
          where: {
            id: { in: attachmentIds },
            userId: user.id,
          },
          data: { messageId: uMsg.id },
        });
      }

      const aMsg = await tx.message.create({
        data: {
          chatId,
          role: "assistant",
          content: [{ type: "thinking", thinking: "Preparing response..." }],
          status: "running",
        },
      });

      const run = await tx.agentRun.create({
        data: {
          chatId,
          messageId: aMsg.id,
          idempotencyKey,
          status: "running",
          model,
        },
      });

      // Update chat title if it is still the default "New Chat"
      if (chat.title === "New Chat") {
        const generatedTitle = content.slice(0, 36).trim() + (content.length > 36 ? "..." : "");
        await tx.chat.update({
          where: { id: chatId },
          data: { title: generatedTitle },
        });
      } else {
        // Touch updatedAt
        await tx.chat.update({
          where: { id: chatId },
          data: { updatedAt: new Date() },
        });
      }

      return [uMsg, aMsg, run];
    });

    // 1. Dispatch durable background task in Trigger.dev
    triggerClient
      .dispatchAgentTurn({
        runId: agentRun.id,
        chatId,
        messageId: assistantMessage.id,
        content,
        model,
        isPlanMode: Boolean(planMode),
        idempotencyKey,
      })
      .catch((err) => {
        console.warn("[Trigger.dev] Task trigger warning:", err);
      });

    // 2. Fire off agent execution inside Next.js 15 after() to prevent serverless freeze
    after(async () => {
      try {
        await runManager.executeRun(agentRun.id, chatId, assistantMessage.id, Boolean(planMode));
      } catch (err) {
        console.error(`Async run execution failed for ${agentRun.id}:`, err);
      }
    });

    return NextResponse.json(
      {
        chatId,
        userMessage,
        assistantMessage,
        runId: agentRun.id,
        status: "running",
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("POST /api/chats/[id]/messages error:", error);
    return NextResponse.json({ error: "Failed to dispatch message turn" }, { status: 500 });
  }
}
