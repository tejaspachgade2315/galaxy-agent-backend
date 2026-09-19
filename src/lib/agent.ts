import { prisma } from "./prisma";
import { streamOpenRouter, OpenRouterMessage } from "./openrouter";
import { ContentBlock } from "../contracts";
import { toolRegistry, initializeToolsAndSkills } from "./tools";
import { skillRegistry } from "./skills";
import { dispatchWebhook } from "./webhooks";

type StreamListener = (event: string, data: any) => void;

interface StreamEvent {
  event: string;
  data: any;
}

interface ActiveStreamState {
  chatId: string;
  thinking: string;
  text: string;
  status: string;
  contentBlocks: ContentBlock[];
  events: StreamEvent[];
  isTerminal: boolean;
}

class RunManager {
  private listeners: Map<string, Set<StreamListener>> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private activeStreams: Map<string, ActiveStreamState> = new Map();

  subscribe(runId: string, listener: StreamListener): () => void {
    if (!this.listeners.has(runId)) {
      this.listeners.set(runId, new Set());
    }
    this.listeners.get(runId)!.add(listener);

    // If stream is active or recently completed, replay full event stream in order
    const current = this.activeStreams.get(runId);
    if (current && current.events.length > 0) {
      for (const ev of current.events) {
        try {
          listener(ev.event, ev.data);
        } catch (err) {
          console.error("Error during SSE replay:", err);
        }
      }
    }

    return () => {
      this.listeners.get(runId)?.delete(listener);
      if (this.listeners.get(runId)?.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  emit(runId: string, event: string, data: any) {
    const streamState = this.activeStreams.get(runId);
    if (streamState) {
      streamState.events.push({ event, data });
      if (event === "done" || event === "error") {
        streamState.isTerminal = true;
      }
    }

    const list = this.listeners.get(runId);
    if (list) {
      for (const listener of list) {
        try {
          listener(event, data);
        } catch (err) {
          console.error("Error in SSE listener:", err);
        }
      }
    }
  }

  private waitpointResolvers: Map<string, (val: any) => void> = new Map();

  registerWaitpointResolver(token: string, resolver: (val: any) => void) {
    this.waitpointResolvers.set(token, resolver);
  }

  resolveWaitpoint(token: string, result: any): boolean {
    const resolver = this.waitpointResolvers.get(token);
    if (resolver) {
      resolver(result);
      this.waitpointResolvers.delete(token);
      return true;
    }
    return false;
  }

  cancel(runId: string) {
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(runId);
    }
    // Also resolve any pending waitpoints for this run
    for (const [token, resolver] of this.waitpointResolvers.entries()) {
      if (token.includes(runId)) {
        resolver({ approved: false, reason: "cancelled" });
        this.waitpointResolvers.delete(token);
      }
    }
    this.emit(runId, "status", { status: "cancelled" });
    this.emit(runId, "done", { runId, status: "cancelled" });
  }

  async executeRun(runId: string, chatId: string, assistantMessageId: string, isPlanMode = false) {
    initializeToolsAndSkills();

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

    const streamState: ActiveStreamState = {
      chatId,
      thinking: "",
      text: "",
      status: "thinking",
      contentBlocks: [],
      events: [],
      isTerminal: false,
    };
    this.activeStreams.set(runId, streamState);
    this.emit(runId, "status", {
      status: "thinking",
      step: isPlanMode ? "Architecting strategic execution plan..." : "Analyzing conversation & intent...",
    });
    dispatchWebhook("agent.started", { runId, chatId, isPlanMode }).catch(() => {});

    const startTime = Date.now();
    let accumulatedThinking = "";
    let accumulatedText = "";
    const contentBlocks: ContentBlock[] = [];
    let totalCreditsCost = 0;

    try {
      // 1. Fetch user ID from chat
      const chat = await prisma.chat.findUnique({ where: { id: chatId }, select: { userId: true } });
      const userId = chat?.userId || "anonymous";

      // 2. Build conversation history for prompt context
      const messages = await prisma.message.findMany({
        where: { chatId, status: { not: "failed" } },
        orderBy: { createdAt: "asc" },
        take: 30,
        include: { attachments: true },
      });

      const skillSummary = skillRegistry.getPromptSummary();
      const baseInstructions = isPlanMode
        ? [
            "You are Galaxy Agent operating in strict PLAN MODE.",
            "In PLAN MODE, your primary duty is to be a master software architect and strategic planner.",
            "Do NOT immediately execute irreversible or destructive actions without outlining the strategy.",
            "Instead, structure your response as follows:",
            "### 🎯 Strategic Objective",
            "A concise breakdown of what the user wants to accomplish.",
            "",
            "### 📋 Step-by-Step Execution Plan",
            "Numbered phases with actionable markdown checklists (e.g. `- [ ] Phase 1: ...`, `- [ ] Step 2: ...`).",
            "",
            "### 🛠️ Required Tools & Skills",
            "List the specific tools (e.g., crop_image, gpt_image_2, merge_videos) or guidance skills needed, along with estimated credit consumption.",
            "",
            "### ⚠️ Edge Cases & Architectural Risks",
            "List any potential failures (e.g. invalid aspect ratios, rate limits, video format compatibility) and how they will be mitigated.",
            "",
            "### 🚀 Next Action",
            "Ask the user for approval or guidance on specific options before continuing with heavy tool execution.",
          ]
        : [
            "You are Galaxy Agent, a frontier AI engineer and creative agent workspace.",
            "You have access to typed tools and on-demand guidance skills.",
            "When performing image cropping, image generation/editing, or video merging, you MUST use the provided typed tools.",
            "When specialized guidance is needed, you may call load_skill to read instructions before executing actions.",
            "Think step-by-step before calling tools.",
          ];

      const systemPrompt = [
        ...baseInstructions,
        "",
        skillSummary,
      ].join("\n");

      const openRouterMessages: OpenRouterMessage[] = [
        { role: "system", content: systemPrompt },
      ];

      for (const msg of messages) {
        if (msg.id === assistantMessageId) continue;
        const blocks = Array.isArray(msg.content) ? (msg.content as any[]) : [];
        let textContent = blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");

        if (msg.attachments && msg.attachments.length > 0) {
          const attachmentNotes = msg.attachments
            .map((att) => `[Attached File: ${att.fileName} | Type: ${att.fileType} | URL: ${att.url}]`)
            .join("\n");
          textContent = textContent ? `${textContent}\n\n${attachmentNotes}` : attachmentNotes;
        }

        if (textContent) {
          openRouterMessages.push({
            role: msg.role as any,
            content: textContent,
          });
        }
      }

      const availableTools = toolRegistry.getOpenAIToolDefinitions();
      const maxSteps = 5;
      let step = 0;

      // 3. Multi-turn Agent Loop (allows tool chaining: e.g. gpt_image_2 -> crop_image)
      while (step < maxSteps) {
        step++;
        if (abortController.signal.aborted) break;

        this.emit(runId, "status", { status: "working", step: step > 1 ? "Continuing execution..." : "Generating response..." });

        const stream = streamOpenRouter(openRouterMessages, availableTools, abortController.signal);
        let stepText = "";
        const toolCallsMap: Map<number, { id: string; name: string; argumentsStr: string }> = new Map();

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;

          if (chunk.type === "thinking") {
            accumulatedThinking += chunk.content;
            streamState.thinking = accumulatedThinking;
            this.emit(runId, "thinking", { text: chunk.content });
          } else if (chunk.type === "text") {
            stepText += chunk.content;
            accumulatedText += chunk.content;
            streamState.text = accumulatedText;
            this.emit(runId, "text_delta", { text: chunk.content });
          } else if (chunk.type === "tool_call" && chunk.toolCall) {
            const { index, id, name, argumentsDelta } = chunk.toolCall;
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, { id: id || `call_${Date.now()}_${index}`, name: name || "", argumentsStr: "" });
            }
            const tc = toolCallsMap.get(index)!;
            if (id) tc.id = id;
            if (name) tc.name = name;
            if (argumentsDelta) tc.argumentsStr += argumentsDelta;
          }
        }

        const toolCalls = Array.from(toolCallsMap.values()).filter((tc) => tc.name);

        // If no tool calls, model completed its response
        if (toolCalls.length === 0) {
          break;
        }

        // Add assistant message with tool calls to prompt history
        openRouterMessages.push({
          role: "assistant",
          content: stepText || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.argumentsStr },
          })),
        });

        // Execute each tool call
        for (const tc of toolCalls) {
          if (abortController.signal.aborted) break;

          let parsedInput: any = {};
          try {
            parsedInput = tc.argumentsStr ? JSON.parse(tc.argumentsStr) : {};
          } catch (_) {
            parsedInput = {};
          }

          // Emit tool_start
          this.emit(runId, "tool_start", {
            toolCallId: tc.id,
            name: tc.name,
            input: parsedInput,
          });

          const toolCallBlock: ContentBlock = {
            type: "tool_call",
            toolCallId: tc.id,
            name: tc.name,
            input: parsedInput,
          };
          contentBlocks.push(toolCallBlock);
          streamState.contentBlocks.push(toolCallBlock);

          this.emit(runId, "status", { status: "working", step: `Running ${tc.name}...` });

          const toolStartTime = Date.now();
          // Execute via typed registry
          const executionResult = await toolRegistry.execute(tc.name, parsedInput, {
            chatId,
            runId,
            userId,
            signal: abortController.signal,
          });
          const toolDurationMs = Date.now() - toolStartTime;

          totalCreditsCost += executionResult.creditsCost;

          // Emit tool_end
          this.emit(runId, "tool_end", {
            toolCallId: tc.id,
            name: tc.name,
            output: executionResult.output,
            creditsCost: executionResult.creditsCost,
            durationMs: toolDurationMs,
          });
          dispatchWebhook("tool.completed", {
            runId,
            chatId,
            toolName: tc.name,
            creditsCost: executionResult.creditsCost,
            isError: executionResult.isError,
          }).catch(() => {});

          const toolResultBlock: ContentBlock = {
            type: "tool_result",
            toolCallId: tc.id,
            name: tc.name,
            output: executionResult.output,
            isError: executionResult.isError,
            creditsCost: executionResult.creditsCost,
            durationMs: toolDurationMs,
          };
          contentBlocks.push(toolResultBlock);
          streamState.contentBlocks.push(toolResultBlock);

          // Feed result back into OpenRouter message list for next step
          openRouterMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.name,
            content: JSON.stringify(executionResult.output),
          });
        }
      }

      const durationMs = Date.now() - startTime;

      // Handle Plan Mode Human Waitpoint
      if (isPlanMode && !abortController.signal.aborted) {
        const waitpointToken = `wp_${runId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const waitpoint = await prisma.waitpoint.create({
          data: {
            runId,
            token: waitpointToken,
            type: "plan_approval",
            status: "pending",
            payload: {
              title: "Strategic Execution Plan Approval",
              summary: "Review the proposed plan above. Do you approve proceeding with execution?",
            },
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        });

        await prisma.agentRun.update({
          where: { id: runId },
          data: { status: "waiting" },
        });

        this.emit(runId, "status", { status: "waiting", step: "Awaiting human plan approval..." });
        this.emit(runId, "waitpoint", {
          id: waitpoint.id,
          runId,
          token: waitpointToken,
          type: "plan_approval",
          payload: waitpoint.payload,
        });

        // Wait safely for user response or cancellation
        const decision = await new Promise<{ approved: boolean; response?: any }>((resolve) => {
          this.registerWaitpointResolver(waitpointToken, resolve);
          const timer = setTimeout(() => {
            resolve({ approved: false, response: { reason: "Waitpoint expired without user input" } });
          }, 10 * 60 * 1000);

          abortController.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve({ approved: false, response: { reason: "cancelled" } });
          });
        });

        if (decision.approved) {
          accumulatedText += "\n\n> 📋 **Plan Status**: Approved by user. Ready for execution.";
        } else {
          accumulatedText += "\n\n> ⚠️ **Plan Status**: Halted or rejected by user.";
        }
      }

      // Assemble final persisted message content blocks
      const finalBlocks: ContentBlock[] = [];
      if (accumulatedThinking.trim().length > 0) {
        finalBlocks.push({
          type: "thinking",
          thinking: accumulatedThinking.trim(),
          durationMs,
        });
      }
      for (const b of contentBlocks) {
        finalBlocks.push(b);
      }
      if (accumulatedText.trim().length > 0) {
        finalBlocks.push({
          type: "text",
          text: accumulatedText.trim(),
        });
      } else if (contentBlocks.length === 0) {
        finalBlocks.push({
          type: "text",
          text: "No response was generated.",
        });
      }

      const finalStatus = abortController.signal.aborted ? "cancelled" : "completed";

      // Persist terminal message and agent run
      await prisma.$transaction([
        prisma.message.update({
          where: { id: assistantMessageId },
          data: {
            content: finalBlocks as any,
            status: finalStatus,
          },
        }),
        prisma.agentRun.update({
          where: { id: runId },
          data: {
            status: finalStatus,
            creditsCost: totalCreditsCost,
            completedAt: new Date(),
          },
        }),
      ]);

      // Deduct tool credits if billable
      if (totalCreditsCost > 0 && userId) {
        try {
          await prisma.user.update({
            where: { id: userId },
            data: { creditsBalance: { decrement: totalCreditsCost } },
          });
          await prisma.creditLedger.create({
            data: {
              userId,
              amount: -totalCreditsCost,
              balanceAfter: 0,
              reason: `Agent turn run ${runId}`,
              idempotencyKey: `charge_${runId}`,
            },
          });
        } catch (creditErr) {
          console.warn("[executeRun] Credit settlement warning:", creditErr);
        }
      }

      this.emit(runId, "status", { status: finalStatus });
      dispatchWebhook("agent.completed", {
        runId,
        chatId,
        status: finalStatus,
        creditsCost: totalCreditsCost,
        durationMs,
      }).catch(() => {});
      this.emit(runId, "done", {
        runId,
        status: finalStatus,
        messageId: assistantMessageId,
      });
    } catch (error: any) {
      console.error(`Agent run ${runId} failed:`, error);
      const isAbort = abortController.signal.aborted;
      const status = isAbort ? "cancelled" : "failed";
      const errorMsg = error?.message || "An unexpected error occurred during execution.";

      const finalBlocks: ContentBlock[] = [];
      if (accumulatedThinking) {
        finalBlocks.push({ type: "thinking", thinking: accumulatedThinking });
      }
      for (const b of contentBlocks) {
        finalBlocks.push(b);
      }
      if (accumulatedText) {
        finalBlocks.push({ type: "text", text: accumulatedText });
      }

      await prisma.$transaction([
        prisma.message.update({
          where: { id: assistantMessageId },
          data: {
            content: finalBlocks as any,
            status,
            errorMessage: errorMsg,
          },
        }),
        prisma.agentRun.update({
          where: { id: runId },
          data: {
            status,
            errorMessage: errorMsg,
            completedAt: new Date(),
          },
        }),
      ]);

      this.emit(runId, "status", { status });
      this.emit(runId, "error", { message: errorMsg });
      dispatchWebhook("agent.failed", {
        runId,
        chatId,
        error: errorMsg,
        status,
      }).catch(() => {});
      this.emit(runId, "done", { runId, status, messageId: assistantMessageId });
    } finally {
      this.abortControllers.delete(runId);
      const state = this.activeStreams.get(runId);
      if (state) {
        state.isTerminal = true;
      }
      setTimeout(() => {
        this.activeStreams.delete(runId);
      }, 60000);
    }
  }
}

const globalForAgent = globalThis as unknown as {
  runManager: RunManager | undefined;
};

export const runManager = globalForAgent.runManager ?? new RunManager();

if (process.env.NODE_ENV !== "production") {
  globalForAgent.runManager = runManager;
}
