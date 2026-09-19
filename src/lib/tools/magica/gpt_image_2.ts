import { z } from "zod";
import { AgentTool, ToolExecutionContext } from "../types";
import { magicaClient } from "./client";

export const GPTImage2InputSchema = z.object({
  prompt: z.string().min(1).max(2000).describe("Descriptive text prompt for generating or modifying the image"),
  image_url: z
    .string()
    .url()
    .optional()
    .describe("Optional source image URL. If provided, the tool runs in gpt-image-2-edit mode to modify the image"),
  aspect_ratio: z
    .string()
    .optional()
    .default("1:1")
    .describe("Desired aspect ratio of the output image (e.g. '1:1', '16:9', '9:16', '4:3', '3:4')"),
});

export const GPTImage2OutputSchema = z.object({
  image_url: z.string().url(),
  prompt: z.string(),
  mode: z.string(),
  status: z.string(),
});

export type GPTImage2Input = z.infer<typeof GPTImage2InputSchema>;
export type GPTImage2Output = z.infer<typeof GPTImage2OutputSchema>;

export const gptImage2Tool: AgentTool<GPTImage2Input, GPTImage2Output> = {
  name: "gpt_image_2",
  description:
    "Generates a new image from a text prompt (gpt-image-2-text) or modifies an existing image (gpt-image-2-edit). Call this tool when the user asks to generate, design, or edit pictures or artwork.",
  inputSchema: GPTImage2InputSchema,
  outputSchema: GPTImage2OutputSchema,
  creditsCost: 10,
  async execute(input: GPTImage2Input, context: ToolExecutionContext): Promise<GPTImage2Output> {
    return magicaClient.runNode("gpt_image_2", input, context.signal);
  },
};
