import { describe, it, expect } from "vitest";
import { skillRegistry } from "../src/lib/skills";
import { loadSkillTool, readSkillAssetTool } from "../src/lib/skills/tools";

describe("Progressive On-Demand Skills System", () => {
  it("should discover registered skills from agent-skills folder", () => {
    const skills = skillRegistry.getAll();
    expect(skills.length).toBeGreaterThanOrEqual(3);

    const names = skills.map((s) => s.name);
    expect(names).toContain("architecture-review");
    expect(names).toContain("image-editing");
    expect(names).toContain("video-processing");
  });

  it("should generate concise prompt summary without bloating prompt context", () => {
    const summary = skillRegistry.getPromptSummary();
    expect(summary).toContain("Available Skills");
    expect(summary).toContain("architecture-review");
    expect(summary).toContain("image-editing");
    expect(summary).toContain("video-processing");
    // Summary must be lightweight (less than 2000 characters)
    expect(summary.length).toBeLessThan(2000);
  });

  it("should dynamically read skill content and compute valid SHA-256 hash", () => {
    const { content, contentHash } = skillRegistry.readSkillContent("image-editing");

    expect(contentHash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex string
    expect(content).toContain("crop_image");
  });

  it("should validate input schema for load_skill", () => {
    const valid = loadSkillTool.inputSchema.safeParse({
      skill_name: "image-editing",
    });
    expect(valid.success).toBe(true);

    const invalid = loadSkillTool.inputSchema.safeParse({});
    expect(invalid.success).toBe(false);
  });

  it("should validate input schema for read_skill_asset", () => {
    const valid = readSkillAssetTool.inputSchema.safeParse({
      skill_name: "image-editing",
      asset_path: "guide.md",
    });
    expect(valid.success).toBe(true);

    const invalid = readSkillAssetTool.inputSchema.safeParse({
      skill_name: "image-editing",
    });
    expect(invalid.success).toBe(false);
  });

  it("should throw error for non-existent skill in readSkillContent", () => {
    expect(() => {
      skillRegistry.readSkillContent("non-existent-skill");
    }).toThrow();
  });
});
