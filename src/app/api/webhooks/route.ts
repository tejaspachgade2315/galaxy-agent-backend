import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { dispatchWebhook } from "@/lib/webhooks";

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      enabled: Boolean(process.env.WEBHOOK_URL),
      webhookUrl: process.env.WEBHOOK_URL || null,
      supportedEvents: [
        "agent.started",
        "agent.completed",
        "agent.failed",
        "tool.completed",
      ],
      signatureHeader: "X-Galaxy-Signature",
      signatureAlgorithm: "HMAC-SHA256",
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to inspect webhooks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const event = body.event || "tool.completed";
    const data = body.data || { test: true, timestamp: new Date().toISOString() };

    const dispatched = await dispatchWebhook(event, data);

    return NextResponse.json({
      success: true,
      dispatched,
      event,
      note: process.env.WEBHOOK_URL
        ? `Webhook sent to ${process.env.WEBHOOK_URL}`
        : "WEBHOOK_URL not configured in .env. Dispatched mock event successfully.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to trigger webhook test" }, { status: 500 });
  }
}
