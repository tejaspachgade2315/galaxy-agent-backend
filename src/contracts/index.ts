import { z } from "zod";

// ==============================================================================
// CONTENT BLOCKS
// ==============================================================================
export const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const ThinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  durationMs: z.number().optional(),
});

export const ToolCallBlockSchema = z.object({
  type: z.literal("tool_call"),
  toolCallId: z.string(),
  name: z.string(),
  input: z.record(z.any()),
});

export const ToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  toolCallId: z.string(),
  name: z.string(),
  output: z.any().optional(),
  isError: z.boolean().optional(),
  creditsCost: z.number().optional(),
});

export const ContentBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ThinkingBlockSchema,
  ToolCallBlockSchema,
  ToolResultBlockSchema,
]);

export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type TextBlock = z.infer<typeof TextBlockSchema>;
export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>;
export type ToolCallBlock = z.infer<typeof ToolCallBlockSchema>;
export type ToolResultBlock = z.infer<typeof ToolResultBlockSchema>;

// ==============================================================================
// MESSAGE CONTRACTS
// ==============================================================================
export const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export const MessageStatusSchema = z.enum(["pending", "running", "completed", "failed", "cancelled"]);

export const MessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  role: MessageRoleSchema,
  content: z.array(ContentBlockSchema),
  status: MessageStatusSchema,
  errorMessage: z.string().nullable().optional(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});

export type Message = z.infer<typeof MessageSchema>;

// ==============================================================================
// CHAT CONTRACTS
// ==============================================================================
export const ChatSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  isPinned: z.boolean(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});

export type Chat = z.infer<typeof ChatSchema>;

export const CreateChatInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

export const UpdateChatInputSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  isPinned: z.boolean().optional(),
});

export const SendMessageInputSchema = z.object({
  content: z.string().min(1).max(32000),
  model: z.string().default("openrouter/free"),
  idempotencyKey: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
  planMode: z.boolean().optional(),
});

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

// ==============================================================================
// RUN & STREAMING EVENTS
// ==============================================================================
export const RunStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);

export const AgentRunSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  messageId: z.string(),
  idempotencyKey: z.string(),
  status: RunStatusSchema,
  model: z.string(),
  routedModel: z.string().nullable().optional(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  creditsCost: z.number(),
  errorMessage: z.string().nullable().optional(),
  startedAt: z.string().or(z.date()),
  completedAt: z.string().or(z.date()).nullable().optional(),
});

export type AgentRun = z.infer<typeof AgentRunSchema>;

// SSE Event payloads
export type SSEEvent =
  | { event: "status"; data: { status: string; step?: string } }
  | { event: "thinking"; data: { text: string } }
  | { event: "text_delta"; data: { text: string } }
  | { event: "tool_start"; data: { toolCallId: string; name: string; input: any } }
  | { event: "tool_end"; data: { toolCallId: string; name: string; output: any; creditsCost?: number } }
  | { event: "done"; data: { runId: string; status: string; messageId: string; promptTokens?: number; completionTokens?: number } }
  | { event: "error"; data: { message: string } };
