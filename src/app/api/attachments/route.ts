import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const CreateAttachmentInputSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().positive(),
  url: z.string().url(),
  assemblyId: z.string().optional(),
  status: z.enum(["uploading", "ready", "failed"]).default("ready"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parse = CreateAttachmentInputSchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json(
        { error: "Invalid attachment payload", details: parse.error.format() },
        { status: 400 }
      );
    }

    const { fileName, fileType, fileSize, url, assemblyId, status } = parse.data;

    // Enforce Transloadit Community plan 0.5 GB (500 MB) limit per file
    const maxBytes = 500 * 1024 * 1024;
    if (fileSize > maxBytes) {
      return NextResponse.json(
        { error: "File exceeds 500 MB Transloadit Community limit" },
        { status: 400 }
      );
    }

    const attachment = await prisma.attachment.create({
      data: {
        userId: user.id,
        fileName,
        fileType,
        fileSize,
        url,
        assemblyId,
        status,
      },
    });

    return NextResponse.json(attachment, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/attachments error:", error);
    return NextResponse.json({ error: "Failed to create attachment" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const messageId = searchParams.get("messageId");

    const attachments = await prisma.attachment.findMany({
      where: {
        userId: user.id,
        ...(messageId ? { messageId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ items: attachments });
  } catch (error: any) {
    console.error("GET /api/attachments error:", error);
    return NextResponse.json({ error: "Failed to fetch attachments" }, { status: 500 });
  }
}
