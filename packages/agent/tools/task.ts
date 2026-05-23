import {
  type LanguageModelUsage,
  type ModelMessage,
  tool,
  type UIToolInvocation,
} from "ai";
import { z } from "zod";
import {
  buildSubagentSummaryLines,
  SUBAGENT_REGISTRY,
  SUBAGENT_TYPES,
} from "../subagents/registry";
import { SUBAGENT_STEP_LIMIT } from "../subagents/constants";
import { sumLanguageModelUsage } from "../usage";
import { getSandboxContext, getSubagentModel } from "./utils";

const subagentTypeSchema = z.enum(SUBAGENT_TYPES);

const subagentSummaryLines = buildSubagentSummaryLines();

const taskInputSchema = z.object({
  subagentType: subagentTypeSchema.describe(
    `Subagent to launch. Available options:\n${subagentSummaryLines}`,
  ),
  task: z
    .string()
    .describe("Short description of the task (displayed to user)"),
  instructions: z.string().describe(
    `Detailed instructions for the subagent. Include:
- Goal and deliverables
- Step-by-step procedure
- Constraints and patterns to follow
- How to verify the work`,
  ),
});

const taskPendingToolCallSchema = z.object({
  name: z.string(),
  input: z.unknown(),
});

export type TaskPendingToolCall = z.infer<typeof taskPendingToolCallSchema>;

const taskRuntimeOutputSchema = z.object({
  mode: z.literal("managed_runtime"),
  label: z.literal("Managed runtime worker"),
  workerType: z.string(),
  profileId: z.string().optional(),
  profileVersion: z.string().optional(),
  profileDisplayName: z.string().optional(),
  sandboxName: z.string().optional(),
});

export const taskOutputSchema = z.object({
  pending: taskPendingToolCallSchema.optional(),
  toolCallCount: z.number().int().nonnegative().optional(),
  startedAt: z.number().int().nonnegative().optional(),
  modelId: z.string().optional(),
  runtime: taskRuntimeOutputSchema.optional(),
  final: z.custom<ModelMessage[]>().optional(),
  usage: z.custom<LanguageModelUsage>().optional(),
});

export type TaskToolOutput = z.infer<typeof taskOutputSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getManagedRuntimeOutput(
  experimentalContext: unknown,
  workerType: string,
): TaskToolOutput["runtime"] {
  if (!isRecord(experimentalContext)) {
    return undefined;
  }

  if (experimentalContext.runtimeMode !== "managed_runtime") {
    return undefined;
  }

  const managedRuntime = isRecord(experimentalContext.managedRuntime)
    ? experimentalContext.managedRuntime
    : {};

  return {
    mode: "managed_runtime",
    label: "Managed runtime worker",
    workerType,
    profileId: getString(managedRuntime.profileId),
    profileVersion: getString(managedRuntime.profileVersion),
    profileDisplayName: getString(managedRuntime.profileDisplayName),
    sandboxName: getString(managedRuntime.sandboxName),
  };
}

export const taskTool = tool({
  needsApproval: false,
  description: `Launch a specialized subagent to handle complex tasks autonomously.

AVAILABLE SUBAGENTS:
${subagentSummaryLines}

WHEN TO USE:
- Clearly-scoped work that can be delegated with explicit instructions
- Work where focused execution would clutter the main conversation
- Tasks that match one of the available subagent descriptions above
- Managed runtime coordinator mode, where repository exploration, implementation, and verification must be delegated

WHEN NOT TO USE (do it yourself):
- Simple, single-file or single-change edits
- Tasks where you already have all the context you need
- Ambiguous work that requires back-and-forth clarification

BEHAVIOR:
- Subagents work AUTONOMOUSLY without asking follow-up questions
- They run up to ${SUBAGENT_STEP_LIMIT} tool steps and then return
- They return ONLY a concise summary - their internal steps are isolated from the parent

HOW TO USE:
- Choose the appropriate subagentType based on the subagent descriptions above
- Provide a short task string (for display) summarizing the goal
- Provide detailed instructions including goals, steps, constraints, and verification criteria

IMPORTANT:
- Be explicit and concrete - subagents cannot ask clarifying questions
- Include critical context (APIs, function names, file paths) in the instructions
- The parent agent will not see the subagent's internal tool calls, only its final summary`,
  inputSchema: taskInputSchema,
  outputSchema: taskOutputSchema,
  execute: async function* (
    { subagentType, task, instructions },
    { experimental_context, abortSignal },
  ) {
    const sandboxContext = getSandboxContext(experimental_context, "task");
    const model = getSubagentModel(experimental_context, "task");
    const subagentModelId = typeof model === "string" ? model : model.modelId;
    const runtime = getManagedRuntimeOutput(experimental_context, subagentType);

    const subagent = SUBAGENT_REGISTRY[subagentType].agent;

    const result = await subagent.stream({
      prompt:
        "Complete this task and provide a summary of what you accomplished.",
      options: {
        task,
        instructions,
        sandbox: sandboxContext.sandbox,
        model,
      },
      abortSignal,
    });

    const startedAt = Date.now();
    let toolCallCount = 0;
    let pending: TaskPendingToolCall | undefined;
    let usage: LanguageModelUsage | undefined;

    // Emit an initial state so UIs can show elapsed time from a stable timestamp.
    yield { toolCallCount, startedAt, modelId: subagentModelId, runtime };

    for await (const part of result.fullStream) {
      if (part.type === "tool-call") {
        toolCallCount += 1;
        pending = { name: part.toolName, input: part.input };
        yield {
          pending,
          toolCallCount,
          usage,
          startedAt,
          modelId: subagentModelId,
          runtime,
        };
      }

      if (part.type === "finish-step") {
        usage = sumLanguageModelUsage(usage, part.usage);
        // Keep the last observed tool call in interim updates so task UIs don't
        // flicker back to an initializing state between subagent steps.
        yield {
          pending,
          toolCallCount,
          usage,
          startedAt,
          modelId: subagentModelId,
          runtime,
        };
      }
    }

    const response = await result.response;
    const finalUsage = usage ?? (await result.usage);
    yield {
      final: response.messages,
      toolCallCount,
      usage: finalUsage,
      startedAt,
      modelId: subagentModelId,
      runtime,
    };
  },
  toModelOutput: ({ output: { final: messages } }) => {
    if (!messages) {
      return { type: "text", value: "Task completed." };
    }

    const lastAssistantMessage = messages.findLast(
      (p) => p.role === "assistant",
    );
    const content = lastAssistantMessage?.content;

    if (!content) {
      return { type: "text", value: "Task completed." };
    }

    if (typeof content === "string") {
      return { type: "text", value: content };
    }

    const lastTextPart = content.findLast((p) => p.type === "text");
    if (!lastTextPart) {
      return { type: "text", value: "Task completed." };
    }

    return { type: "text", value: lastTextPart.text };
  },
});

export type TaskToolUIPart = UIToolInvocation<typeof taskTool>;
