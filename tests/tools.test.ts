import { describe, it, expect } from "vitest";
import { toolRegistry, initializeToolsAndSkills } from "../src/lib/tools";
import { cropImageTool } from "../src/lib/tools/magica/crop_image";
import { gptImage2Tool } from "../src/lib/tools/magica/gpt_image_2";
import { mergeVideosTool } from "../src/lib/tools/magica/merge_videos";

describe("Provider-Neutral Typed Tool Registry", () => {
  initializeToolsAndSkills();

  it("should register all 5 default tools (3 Magica + 2 Skills)", () => {
    const tools = toolRegistry.getAll();
    expect(tools.length).toBeGreaterThanOrEqual(5);

    const names = tools.map((t) => t.name);
    expect(names).toContain("crop_image");
    expect(names).toContain("gpt_image_2");
    expect(names).toContain("merge_videos");
    expect(names).toContain("load_skill");
    expect(names).toContain("read_skill_asset");
  });

  it("should convert Zod schemas to valid OpenAI function definitions", () => {
    const definitions = toolRegistry.getOpenAIToolDefinitions();
    expect(definitions.length).toBeGreaterThanOrEqual(5);

    for (const def of definitions) {
      expect(def.type).toBe("function");
      expect(def.function.name).toBeTruthy();
      expect(def.function.description).toBeTruthy();
      expect(def.function.parameters.type).toBe("object");
    }
  });

  it("should validate input schema for crop_image", () => {
    // Valid normalized coordinates
    const valid = cropImageTool.inputSchema.safeParse({
      image_url: "https://images.unsplash.com/photo-1534447677768-be436bb09401",
      crop: {
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
      },
    });
    expect(valid.success).toBe(true);

    // Invalid missing image_url
    const invalid = cropImageTool.inputSchema.safeParse({
      crop: {
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
      },
    });
    expect(invalid.success).toBe(false);
  });

  it("should validate input schema for gpt_image_2", () => {
    // Text to image
    const valid = gptImage2Tool.inputSchema.safeParse({
      prompt: "Futuristic city with flying vehicles",
      aspect_ratio: "16:9",
    });
    expect(valid.success).toBe(true);

    // Empty prompt should fail
    const invalid = gptImage2Tool.inputSchema.safeParse({
      prompt: "",
    });
    expect(invalid.success).toBe(false);
  });

  it("should validate input schema for merge_videos", () => {
    // Valid: 2 videos with transition
    const valid = mergeVideosTool.inputSchema.safeParse({
      video_urls: ["https://example.com/clip1.mp4", "https://example.com/clip2.mp4"],
      transition: "fade",
    });
    expect(valid.success).toBe(true);

    // Invalid: only 1 video (requires at least 2)
    const invalid = mergeVideosTool.inputSchema.safeParse({
      video_urls: ["https://example.com/clip1.mp4"],
    });
    expect(invalid.success).toBe(false);
  });
});
