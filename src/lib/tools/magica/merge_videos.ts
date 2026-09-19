import { z } from "zod";
import { AgentTool, ToolExecutionContext } from "../types";
import { magicaClient } from "./client";

export const MergeVideosInputSchema = z.object({
  video_urls: z
    .array(z.string().url())
    .min(2, "At least 2 video URLs are required")
    .max(100, "Maximum 100 video URLs supported")
    .describe("Ordered list of public video URLs to concatenate"),
  transition: z
    .enum(["none", "fade", "dissolve"])
    .optional()
    .default("fade")
    .describe("Transition effect between consecutive video clips"),
});

export const MergeVideosOutputSchema = z.object({
  video_url: z.string().url(),
  input_count: z.number(),
  transition: z.string(),
  duration: z.number().optional(),
  status: z.string(),
});

export type MergeVideosInput = z.infer<typeof MergeVideosInputSchema>;
export type MergeVideosOutput = z.infer<typeof MergeVideosOutputSchema>;

export const mergeVideosTool: AgentTool<MergeVideosInput, MergeVideosOutput> = {
  name: "merge_videos",
  description:
    "Merges multiple video clips sequentially into a single video with transitions (fade, dissolve, or none). Call this tool when combining video files.",
  inputSchema: MergeVideosInputSchema,
  outputSchema: MergeVideosOutputSchema,
  creditsCost: 15,
  async execute(input: MergeVideosInput, context: ToolExecutionContext): Promise<MergeVideosOutput> {
    return magicaClient.runNode("merge_videos", input, context.signal);
  },
};
