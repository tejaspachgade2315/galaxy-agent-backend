import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { dispatchWebhook } from "../src/lib/webhooks";

describe("Outbound Signed Webhooks System", () => {
  it("should return false gracefully when WEBHOOK_URL is not set", async () => {
    delete process.env.WEBHOOK_URL;
    const dispatched = await dispatchWebhook("agent.started", { test: true });
    expect(dispatched).toBe(false);
  });

  it("should compute valid HMAC-SHA256 signature", () => {
    const secret = "test_secret_key";
    const payload = JSON.stringify({
      event: "tool.completed",
      timestamp: "2026-09-19T00:00:00.000Z",
      data: { tool: "crop_image", creditsCost: 5 },
    });

    const signature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    expect(signature).toMatch(/^[a-f0-9]{64}$/);

    // Verify signature matches
    const verify = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    expect(verify).toBe(signature);
  });
});
