import crypto from "crypto";

export type WebhookEventType =
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "tool.completed";

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, any>;
}

/**
 * Dispatches an outbound signed webhook to the configured WEBHOOK_URL.
 * Uses HMAC-SHA256 for cryptographic signature verification.
 */
export async function dispatchWebhook(
  event: WebhookEventType,
  data: Record<string, any>
): Promise<boolean> {
  const webhookUrl = process.env.WEBHOOK_URL;
  const webhookSecret = process.env.WEBHOOK_SECRET || "galaxy_default_webhook_secret_2026";

  if (!webhookUrl) {
    // Webhook not configured; silent return
    return false;
  }

  const timestamp = new Date().toISOString();
  const payload: WebhookPayload = {
    event,
    timestamp,
    data,
  };

  const payloadString = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", webhookSecret)
    .update(payloadString)
    .digest("hex");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Galaxy-Event": event,
        "X-Galaxy-Signature": `sha256=${signature}`,
        "X-Galaxy-Timestamp": timestamp,
      },
      body: payloadString,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return res.ok;
  } catch (err: any) {
    console.warn(`[Webhook] Failed to dispatch ${event} to ${webhookUrl}:`, err.message);
    return false;
  }
}
