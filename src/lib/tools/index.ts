import { toolRegistry } from "./registry";
import { cropImageTool } from "./magica/crop_image";
import { gptImage2Tool } from "./magica/gpt_image_2";
import { mergeVideosTool } from "./magica/merge_videos";
import { loadSkillTool, readSkillAssetTool } from "../skills/tools";
import { skillRegistry } from "../skills";

let initialized = false;

export function initializeToolsAndSkills() {
  if (initialized) return;

  // 1. Initialize Progressive Skills
  skillRegistry.initialize();

  // 2. Register Mandatory Magica Tools
  toolRegistry.register(cropImageTool);
  toolRegistry.register(gptImage2Tool);
  toolRegistry.register(mergeVideosTool);

  // 3. Register On-Demand Skill Tools
  toolRegistry.register(loadSkillTool);
  toolRegistry.register(readSkillAssetTool);

  initialized = true;
  console.log(`[ToolSystem] Initialized with ${toolRegistry.getAll().length} typed tools.`);
}

export * from "./registry";
export * from "./types";
