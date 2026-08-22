import type { LanguageModel } from "ai";
import { gateway, stepCountIs, ToolLoopAgent } from "ai";
import { z } from "zod";
import { delegatedWorkspaceLaunchPolicySchema } from "../delegated-workspace";
import type {
  ManagedRuntimeAgentContext,
  OpenAgentRuntimeMode,
} from "../open-agent-runtime-mode";
import type { SandboxExecutionContext } from "../types";
import { getDelegatedWorkerToolPolicy } from "../worker-tool-policy";
import {
  SUBAGENT_BASH_RULES,
  SUBAGENT_COMPLETE_TASK_RULES,
  SUBAGENT_NO_QUESTIONS_RULES,
  SUBAGENT_REMINDER,
  SUBAGENT_RESPONSE_FORMAT,
  SUBAGENT_STEP_LIMIT,
  SUBAGENT_VALIDATE_RULES,
  SUBAGENT_WORKING_DIR,
} from "./constants";

const EXECUTOR_SYSTEM_PROMPT = `You are an executor agent - a fire-and-forget subagent that completes specific, well-defined implementation tasks autonomously.

Think of yourself as a productive engineer who cannot ask follow-up questions once started.

## CRITICAL RULES

${SUBAGENT_NO_QUESTIONS_RULES}

${SUBAGENT_COMPLETE_TASK_RULES}

${SUBAGENT_RESPONSE_FORMAT}

Example final response:
---
**Summary**: I created the new user authentication module with JWT validation. I added the auth middleware, updated the routes, and created unit tests.

**Answer**: The authentication system is now implemented:
- \`src/middleware/auth.ts\` - JWT validation middleware
- \`src/routes/auth.ts\` - Login/logout endpoints
- \`src/tests/auth.test.ts\` - Unit tests (all passing)
---

${SUBAGENT_VALIDATE_RULES}

## TOOLS
You have full access to file operations (read, write, edit, grep, glob) and bash commands. Use them to complete your task.

${SUBAGENT_BASH_RULES}`;

const callOptionsSchema = z.object({
  task: z.string().describe("Short description of the task"),
  instructions: z.string().describe("Detailed instructions for the task"),
  sandbox: z
    .custom<SandboxExecutionContext["sandbox"]>()
    .describe("Sandbox for file system and shell operations"),
  model: z.custom<LanguageModel>().describe("Language model for this subagent"),
  workspacePolicy: delegatedWorkspaceLaunchPolicySchema.optional(),
  runtimeMode: z.enum(["classic", "managed_runtime"]).optional(),
  unattended: z.boolean().optional(),
  githubToolAvailable: z.boolean().optional(),
  managedRuntime: z.custom<ManagedRuntimeAgentContext>().optional(),
  allowedBuiltinToolNames: z.array(z.string()).nullish(),
  sessionId: z.string().optional(),
});

export type ExecutorCallOptions = z.infer<typeof callOptionsSchema>;

const defaultExecutorTools = getDelegatedWorkerToolPolicy(
  "executor",
  "classic",
);

export const executorSubagent = new ToolLoopAgent({
  model: gateway("anthropic/claude-haiku-4.5"),
  instructions: EXECUTOR_SYSTEM_PROMPT,
  tools: defaultExecutorTools,
  stopWhen: stepCountIs(SUBAGENT_STEP_LIMIT),
  callOptionsSchema,
  prepareCall: ({ options, ...settings }) => {
    if (!options) {
      throw new Error("Executor subagent requires task call options.");
    }

    const sandbox = options.sandbox;
    const model = options.model ?? settings.model;
    const runtimeMode: OpenAgentRuntimeMode = options.runtimeMode ?? "classic";
    const workerTools = getDelegatedWorkerToolPolicy("executor", runtimeMode, {
      allowedBuiltinToolNames: options.allowedBuiltinToolNames,
      expectedTools: options.managedRuntime?.expectedTools,
      optionalTools: options.managedRuntime?.optionalTools,
    });

    return {
      ...settings,
      model,
      tools: workerTools,
      instructions: `${EXECUTOR_SYSTEM_PROMPT}

${SUBAGENT_WORKING_DIR}

## Your Task
${options.task}

## Detailed Instructions
${options.instructions}

${SUBAGENT_REMINDER}`,
      experimental_context: {
        sandbox,
        model,
        workspacePolicy: options.workspacePolicy,
        runtimeMode,
        unattended: options.unattended ?? false,
        githubToolAvailable: options.githubToolAvailable ?? false,
        managedRuntime: options.managedRuntime,
        allowedBuiltinToolNames: options.allowedBuiltinToolNames ?? null,
        sessionId: options.sessionId,
      },
    };
  },
});
