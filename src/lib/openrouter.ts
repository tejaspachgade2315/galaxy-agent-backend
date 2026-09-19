export interface StreamChunk {
  type: "thinking" | "text" | "tool_call";
  content: string;
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export async function* streamOpenRouter(
  messages: OpenRouterMessage[],
  tools?: any[],
  signal?: AbortSignal
): AsyncGenerator<StreamChunk, { routedModel?: string; promptTokens: number; completionTokens: number }, void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openrouter/free";

  // Fallback mock stream if no API key is set
  if (!apiKey || apiKey.trim() === "") {
    yield* mockStreamingResponse(messages, signal);
    return {
      routedModel: "mock/galaxy-local-orchestrator",
      promptTokens: 120,
      completionTokens: 240,
    };
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Galaxy Agent Chat",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      stream: true,
      include_reasoning: true,
    }),
    signal,
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("OpenRouter Free rate limit reached (429). Please wait a moment before trying again.");
    }
    const errorText = await response.text();
    throw new Error(`OpenRouter Free error (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error("Empty response body from OpenRouter Free");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let inThinkTag = false;
  let routedModel = model;
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") continue;

        if (trimmed.startsWith("data: ")) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.model) routedModel = data.model;
            if (data.usage) {
              promptTokens = data.usage.prompt_tokens || 0;
              completionTokens = data.usage.completion_tokens || 0;
            }

            const choice = data.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (!delta) continue;

            // DeepSeek/frontier reasoning field
            if (delta.reasoning) {
              yield { type: "thinking", content: delta.reasoning };
            }

            // Normal content stream with <think> tag handling
            if (delta.content) {
              let text: string = delta.content;

              if (text.includes("<think>")) {
                inThinkTag = true;
                text = text.replace("<think>", "");
              }

              if (text.includes("</think>")) {
                const parts = text.split("</think>");
                if (parts[0]) yield { type: "thinking", content: parts[0] };
                inThinkTag = false;
                if (parts[1]) yield { type: "text", content: parts[1] };
                continue;
              }

              if (inThinkTag) {
                yield { type: "thinking", content: text };
              } else {
                yield { type: "text", content: text };
              }
            }

            // Streamed tool call deltas with index tracking
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield {
                  type: "tool_call",
                  content: "",
                  toolCall: {
                    index: tc.index ?? 0,
                    id: tc.id,
                    name: tc.function?.name,
                    argumentsDelta: tc.function?.arguments,
                  },
                };
              }
            }
          } catch (_) {
            // Ignore parse errors on individual SSE chunks
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { routedModel, promptTokens, completionTokens };
}

/**
 * High-fidelity local fallback simulation for when OPENROUTER_API_KEY is blank.
 */
async function* mockStreamingResponse(
  messages: OpenRouterMessage[],
  signal?: AbortSignal
): AsyncGenerator<StreamChunk, void, void> {
  const lastUserMessage = messages.filter((m) => m.role === "user").pop()?.content || "Hello";

  // Simulate thinking steps
  const thoughts = [
    "Analyzing user query: \"" + String(lastUserMessage).slice(0, 40) + "...\"\n",
    "Identifying intent and determining response structure...\n",
    "Formulating concise, production-ready response with clean markdown.\n",
  ];

  for (const thought of thoughts) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 200));
    yield { type: "thinking", content: thought };
  }

  await new Promise((r) => setTimeout(r, 150));

  const responseText = `### Galaxy Agent Chat System

I have processed your request using the **Galaxy Agent Engine** with **OpenRouter Free** orchestration.

#### Key Details:
- **Conversation State**: Persisted securely in **PostgreSQL** via Prisma.
- **Relational Integrity**: Foreign keys, stable cursor pagination, and idempotency guarantees are active.
- **Durable Execution**: Agent turns execute asynchronously with real-time SSE stream delivery.

\`\`\`typescript
interface AgentTurnResponse {
  chatId: string;
  runId: string;
  status: "completed";
  routedModel: "openrouter/free";
}
\`\`\`
`;

  const words = responseText.split(" ");
  for (const word of words) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 35));
    yield { type: "text", content: word + " " };
  }
}
