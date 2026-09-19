import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  filePath: string;
  contentHash: string;
}

class SkillRegistry {
  private skills: Map<string, SkillMetadata> = new Map();
  private initialized = false;

  private getSkillsDirectory(): string {
    // In Docker container, files are in /app/agent-skills or /app/src/agent-skills
    const candidates = [
      path.join(process.cwd(), "agent-skills"),
      path.join(process.cwd(), "src", "agent-skills"),
      path.join(__dirname, "..", "..", "agent-skills"),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return candidates[0];
  }

  initialize() {
    if (this.initialized) return;
    const baseDir = this.getSkillsDirectory();
    if (!fs.existsSync(baseDir)) {
      console.warn(`[SkillRegistry] Directory not found: ${baseDir}`);
      return;
    }

    const entries = fs.readdirSync(baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(baseDir, entry.name, "SKILL.md");
        if (fs.existsSync(skillPath)) {
          try {
            const rawContent = fs.readFileSync(skillPath, "utf-8");
            const hash = crypto.createHash("sha256").update(rawContent).digest("hex");
            const frontmatter = this.parseFrontmatter(rawContent);

            const name = frontmatter.name || entry.name;
            const description = frontmatter.description || `Skill for ${entry.name}`;

            this.skills.set(name, {
              name,
              description,
              version: frontmatter.version || "1.0.0",
              filePath: skillPath,
              contentHash: hash,
            });
          } catch (err) {
            console.error(`[SkillRegistry] Failed to parse skill in ${skillPath}:`, err);
          }
        }
      }
    }

    this.initialized = true;
    console.log(`[SkillRegistry] Initialized ${this.skills.size} progressive skills.`);
  }

  get(name: string): SkillMetadata | undefined {
    this.initialize();
    return this.skills.get(name);
  }

  getAll(): SkillMetadata[] {
    this.initialize();
    return Array.from(this.skills.values());
  }

  getPromptSummary(): string {
    const all = this.getAll();
    if (all.length === 0) return "";

    const lines = [
      "Available Skills (call load_skill to view complete operational instructions only when relevant):",
    ];
    for (const s of all) {
      lines.push(`- ${s.name}: ${s.description}`);
    }
    return lines.join("\n");
  }

  readSkillContent(name: string): { content: string; contentHash: string } {
    const meta = this.get(name);
    if (!meta) {
      throw new Error(`Skill "${name}" not found.`);
    }
    const content = fs.readFileSync(meta.filePath, "utf-8");
    return { content, contentHash: meta.contentHash };
  }

  private parseFrontmatter(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!content.startsWith("---")) return result;

    const parts = content.split("---");
    if (parts.length < 3) return result;

    const yamlBlock = parts[1];
    const lines = yamlBlock.split("\n");

    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx !== -1) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        result[key] = val;
      }
    }

    return result;
  }
}

export const skillRegistry = new SkillRegistry();
