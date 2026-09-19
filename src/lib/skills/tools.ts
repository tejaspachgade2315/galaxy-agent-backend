import { z } from "zod";
import path from "path";
import fs from "fs";
import { AgentTool, ToolExecutionContext } from "../tools/types";
import { skillRegistry } from "./index";
import { prisma } from "../prisma";

export const LoadSkillInputSchema = z.object({
  skill_name: z.string().describe("The exact name of the skill to load (e.g. image-editing, video-processing)"),
});

export const LoadSkillOutputSchema = z.object({
  skill_name: z.string(),
  content: z.string(),
  content_hash: z.string(),
});

export const loadSkillTool: AgentTool = {
  name: "load_skill",
  description:
    "Loads the full guidance instructions of an on-demand skill into working memory. Call this whenever a user prompt requires specialized instructions from available skills.",
  inputSchema: LoadSkillInputSchema,
  outputSchema: LoadSkillOutputSchema,
  creditsCost: 0,
  async execute(input: { skill_name: string }, context: ToolExecutionContext) {
    const { content, contentHash } = skillRegistry.readSkillContent(input.skill_name);

    // Durability: Persist loaded skill and hash to PostgreSQL RunSkill
    try {
      await prisma.runSkill.upsert({
        where: {
          runId_skillName: {
            runId: context.runId,
            skillName: input.skill_name,
          },
        },
        update: {
          contentHash,
          loadedAt: new Date(),
        },
        create: {
          runId: context.runId,
          skillName: input.skill_name,
          contentHash: contentHash,
        },
      });
    } catch (err) {
      console.warn("[loadSkillTool] Failed to record RunSkill:", err);
    }

    return {
      skill_name: input.skill_name,
      content,
      content_hash: contentHash,
    };
  },
};

export const ReadSkillAssetInputSchema = z.object({
  skill_name: z.string().describe("The name of the skill folder"),
  asset_path: z.string().describe("Relative path to the asset file inside the skill folder"),
});

export const ReadSkillAssetOutputSchema = z.object({
  skill_name: z.string(),
  asset_path: z.string(),
  content: z.string(),
});

export const readSkillAssetTool: AgentTool = {
  name: "read_skill_asset",
  description: "Reads a specific asset or reference document inside a skill directory.",
  inputSchema: ReadSkillAssetInputSchema,
  outputSchema: ReadSkillAssetOutputSchema,
  creditsCost: 0,
  async execute(input: { skill_name: string; asset_path: string }, context: ToolExecutionContext) {
    const skill = skillRegistry.get(input.skill_name);
    if (!skill) {
      throw new Error(`Skill "${input.skill_name}" does not exist.`);
    }

    const skillDir = path.dirname(skill.filePath);
    const resolvedPath = path.resolve(skillDir, input.asset_path);

    // Security: Path traversal protection
    if (!resolvedPath.startsWith(skillDir)) {
      throw new Error("Path traversal forbidden: cannot access files outside skill directory.");
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Asset "${input.asset_path}" not found in skill "${input.skill_name}".`);
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");
    return {
      skill_name: input.skill_name,
      asset_path: input.asset_path,
      content,
    };
  },
};
