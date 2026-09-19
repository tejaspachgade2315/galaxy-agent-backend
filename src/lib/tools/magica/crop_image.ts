import { z } from "zod";
import { AgentTool, ToolExecutionContext } from "../types";
import { magicaClient } from "./client";

export const CropImageInputSchema = z.object({
  image_url: z.string().url().describe("The public HTTP URL of the source image to crop"),
  crop: z
    .object({
      x: z.number().min(0).max(1).describe("Normalized X offset (0 to 1)"),
      y: z.number().min(0).max(1).describe("Normalized Y offset (0 to 1)"),
      width: z.number().min(0.01).max(1).describe("Normalized width (0 to 1)"),
      height: z.number().min(0.01).max(1).describe("Normalized height (0 to 1)"),
    })
    .describe("Normalized rectangular crop coordinates"),
});

export const CropImageOutputSchema = z.object({
  image_url: z.string().url(),
  crop: z.any(),
  aspect_ratio: z.string().optional(),
  status: z.string(),
});

export type CropImageInput = z.infer<typeof CropImageInputSchema>;
export type CropImageOutput = z.infer<typeof CropImageOutputSchema>;

export const cropImageTool: AgentTool<CropImageInput, CropImageOutput> = {
  name: "crop_image",
  description:
    "Crops an image using normalized rectangular coordinates { x, y, width, height }. Call this tool when the user wants to crop, reframe, or focus on an image area.",
  inputSchema: CropImageInputSchema,
  outputSchema: CropImageOutputSchema,
  creditsCost: 5,
  async execute(input: CropImageInput, context: ToolExecutionContext): Promise<CropImageOutput> {
    return magicaClient.runNode("crop_image", input, context.signal);
  },
};
