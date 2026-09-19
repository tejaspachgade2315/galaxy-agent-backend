import { AgentTool, ToolExecutionContext, zodToJsonSchema } from "./types";
import { prisma } from "../prisma";

export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();

  register(tool: AgentTool) {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool "${tool.name}" is already registered. Overwriting.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  getOpenAIToolDefinitions() {
    return this.getAll().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.inputSchema),
      },
    }));
  }

  async execute(
    name: string,
    rawInput: any,
    context: ToolExecutionContext
  ): Promise<{ output: any; isError: boolean; durationMs: number; creditsCost: number; invocationId: string }> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered in ToolRegistry.`);
    }

    const startTime = Date.now();

    // 1. Zod runtime input validation
    const parsedInput = tool.inputSchema.safeParse(rawInput);
    if (!parsedInput.success) {
      const errorMsg = `Invalid input for tool "${name}": ${parsedInput.error.message}`;
      const inv = await prisma.toolInvocation.create({
        data: {
          runId: context.runId,
          toolName: name,
          input: rawInput,
          status: "failed",
          errorMessage: errorMsg,
          executionTimeMs: 0,
        },
      });
      return {
        output: { error: errorMsg },
        isError: true,
        durationMs: 0,
        creditsCost: 0,
        invocationId: inv.id,
      };
    }

    // 2. Persist running invocation record in PostgreSQL
    const invocation = await prisma.toolInvocation.create({
      data: {
        runId: context.runId,
        toolName: name,
        input: parsedInput.data,
        status: "running",
      },
    });

    try {
      // 3. Execute tool implementation
      const rawOutput = await tool.execute(parsedInput.data, context);
      const durationMs = Date.now() - startTime;

      // 4. Zod runtime output validation
      const parsedOutput = tool.outputSchema.safeParse(rawOutput);
      const finalOutput = parsedOutput.success ? parsedOutput.data : rawOutput;

      // 5. Update PostgreSQL record
      await prisma.toolInvocation.update({
        where: { id: invocation.id },
        data: {
          output: finalOutput,
          status: "completed",
          executionTimeMs: durationMs,
          creditsCost: tool.creditsCost,
          completedAt: new Date(),
        },
      });

      return {
        output: finalOutput,
        isError: false,
        durationMs,
        creditsCost: tool.creditsCost,
        invocationId: invocation.id,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err?.message || `Execution failed for tool "${name}".`;

      await prisma.toolInvocation.update({
        where: { id: invocation.id },
        data: {
          status: "failed",
          errorMessage: errorMsg,
          executionTimeMs: durationMs,
          completedAt: new Date(),
        },
      });

      return {
        output: { error: errorMsg },
        isError: true,
        durationMs,
        creditsCost: 0,
        invocationId: invocation.id,
      };
    }
  }
}

export const toolRegistry = new ToolRegistry();
