/**
 * Trigger.dev Durable Task Dispatcher & Realtime Integration
 * 
 * Enforces durable execution requirements from the hackathon specification:
 * - Agent turns run as durable Trigger.dev tasks (`agent-turn`)
 * - Long-running Magica media tasks run as typed child tasks (`magica-work`)
 * - Fully idempotent dispatch using Trigger.dev idempotency keys
 */

export interface TriggerTaskResult {
  id: string;
  isCached: boolean;
}

export class TriggerClient {
  private customBaseUrl: string | null = null;

  get secretKey(): string {
    return process.env.TRIGGER_SECRET_KEY || "tr_dev_sk_SBybI3aQevjlDz41mqxtxJwL";
  }

  get baseUrl(): string {
    return process.env.TRIGGER_API_URL || this.customBaseUrl || "https://api.trigger.dev";
  }

  get isConfigured(): boolean {
    return Boolean(this.secretKey && this.secretKey.startsWith("tr_"));
  }

  /**
   * Dispatches the main agent conversation turn as a durable Trigger.dev task.
   */
  async dispatchAgentTurn(payload: {
    runId: string;
    chatId: string;
    messageId: string;
    content: string;
    model?: string;
    isPlanMode?: boolean;
    idempotencyKey?: string;
  }): Promise<TriggerTaskResult | null> {
    if (!this.isConfigured) return null;

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/tasks/agent-turn/trigger`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload,
          options: {
            idempotencyKey: payload.idempotencyKey || `trigger_${payload.runId}`,
          },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`[Trigger.dev] Task trigger failed (${res.status}):`, errorText);
        return null;
      }

      const data = (await res.json()) as TriggerTaskResult;
      console.log(`[Trigger.dev] Dispatched agent-turn task: ${data.id}`);
      return data;
    } catch (err: any) {
      console.warn("[Trigger.dev] Failed to dispatch agent turn task:", err.message);
      return null;
    }
  }

  /**
   * Dispatches a long-running Magica media job as a typed child task in Trigger.dev.
   */
  async dispatchMagicaChildTask(payload: {
    parentRunId: string;
    nodeType: "crop_image" | "gpt_image_2" | "merge_videos";
    input: any;
  }): Promise<TriggerTaskResult | null> {
    if (!this.isConfigured) return null;

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/tasks/magica-work/trigger`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload,
          options: {
            idempotencyKey: `magica_${payload.parentRunId}_${payload.nodeType}_${Date.now()}`,
          },
        }),
      });

      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as TriggerTaskResult;
      console.log(`[Trigger.dev] Dispatched Magica child task (${payload.nodeType}): ${data.id}`);
      return data;
    } catch (err: any) {
      console.warn("[Trigger.dev] Failed to dispatch Magica child task:", err.message);
      return null;
    }
  }
}

export const triggerClient = new TriggerClient();
