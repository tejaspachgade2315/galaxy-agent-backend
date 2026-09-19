import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { authenticateRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const authKey = process.env.TRANSLOADIT_KEY;
    const authSecret = process.env.TRANSLOADIT_SECRET;
    const templateId = process.env.TRANSLOADIT_TEMPLATE_ID || "a6d625c9c40d4dae8efdd822f5dcaef4";

    if (!authKey || !authSecret) {
      return NextResponse.json(
        { error: "Transloadit credentials not configured" },
        { status: 500 }
      );
    }

    // Assembly expires in 1 hour
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const paramsObj: Record<string, any> = {
      auth: {
        key: authKey,
        expires,
      },
      template_id: templateId,
      max_size: 500 * 1024 * 1024, // 0.5 GB per file (Community plan limit)
    };

    const params = JSON.stringify(paramsObj);
    const signature = crypto
      .createHmac("sha384", authSecret)
      .update(Buffer.from(params, "utf-8"))
      .digest("hex");

    return NextResponse.json({
      params,
      signature,
      template_id: templateId,
    });
  } catch (error: any) {
    console.error("POST /api/transloadit/assembly error:", error);
    return NextResponse.json({ error: "Failed to generate upload signature" }, { status: 500 });
  }
}
