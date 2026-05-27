import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { WebAgentUIMessage } from "@/app/types";
import { db } from "@/lib/db/client";
import type { Chat, ChatMessage, Session } from "@/lib/db/schema";
import { workflowRuns } from "@/lib/db/schema";
import { getChatMessages } from "@/lib/db/sessions";
import { redactHarnessValue } from "@/lib/harness/redaction";
import {
  listManagedRuntimeProfileRuns,
  toManagedRuntimeProfileRunSnapshot,
} from "@/lib/observability/managed-runtime-profile-runs";
import {
  listSessionEvents,
  toSessionEventSnapshot,
} from "@/lib/observability/events";
import { listManagedBrowserRuns } from "@/lib/sandbox/runtime/browser-runs";
import { listManagedServices } from "@/lib/sandbox/runtime/service-launch";

const MAX_TEXT_CHARS = 4000;

type BundleMessage = {
  id: string;
  role: ChatMessage["role"];
  createdAt: string;
  text: string;
  toolCalls: Array<{
    type: string;
    state?: string;
    name?: string;
    task?: string;
    subagentType?: string;
    runtime?: unknown;
    toolCallCount?: number;
  }>;
};

export type ChatDebugBundle = {
  bundle: {
    kind: "chat_debug_bundle";
    version: 1;
    generatedAt: string;
    redaction: {
      status: "passed";
      notes: string[];
    };
  };
  session: {
    id: string;
    title: string;
    runtimeMode: Session["runtimeMode"];
    managedRuntimeProfileId: string;
    sandboxName: string | null;
    lifecycleState: Session["lifecycleState"];
    repo: string | null;
    branch: string | null;
    createdAt: string;
    updatedAt: string;
  };
  chat: {
    id: string;
    title: string;
    modelId: string | null;
    activeStreamId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  transcript: {
    messageCount: number;
    messages: BundleMessage[];
  };
  runtime: {
    profileRuns: ReturnType<typeof toManagedRuntimeProfileRunSnapshot>[];
    workflowRuns: Array<{
      id: string;
      status: string;
      runtimeMode: string | null;
      modelId: string | null;
      requestId: string | null;
      sandboxName: string | null;
      managedRuntimeProfileId: string | null;
      managedRuntimeProfileVersion: string | null;
      managedRuntimeProfileRunId: string | null;
      errorMessage: string | null;
      startedAt: string;
      finishedAt: string;
      totalDurationMs: number;
      createdAt: string;
    }>;
    services: Awaited<ReturnType<typeof listManagedServices>>;
    browserRuns: Awaited<ReturnType<typeof listManagedBrowserRuns>>;
  };
  events: ReturnType<typeof toSessionEventSnapshot>[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: string): string {
  const redacted = String(redactHarnessValue(value, "text"));
  return redacted.length > MAX_TEXT_CHARS
    ? `${redacted.slice(0, MAX_TEXT_CHARS)}\n[TRUNCATED]`
    : redacted;
}

function getTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      if (part.type === "data-runtime-proof" && isRecord(part.data)) {
        return `Runtime proof: ${JSON.stringify(redactHarnessValue(part.data))}`;
      }
      return "";
    })
    .filter((value) => value.trim().length > 0)
    .join("\n\n");
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function extractToolCalls(
  message: WebAgentUIMessage,
): BundleMessage["toolCalls"] {
  return message.parts.flatMap((part) => {
    if (!isRecord(part) || !String(part.type).startsWith("tool-")) {
      return [];
    }

    const record: Record<string, unknown> = part;
    const input = isRecord(record.input) ? record.input : {};
    const output = isRecord(record.output) ? record.output : {};
    const runtime = isRecord(output.runtime)
      ? redactHarnessValue(output.runtime)
      : undefined;

    return {
      type: String(record.type),
      state: getString(record.state),
      name: getString(record.toolName),
      task: getString(input.task),
      subagentType: getString(input.subagentType),
      runtime,
      toolCallCount: getNumber(output.toolCallCount),
    };
  });
}

function toBundleMessage(message: ChatMessage): BundleMessage {
  const uiMessage = message.parts as WebAgentUIMessage;
  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt.toISOString(),
    text: boundedText(getTextFromParts(uiMessage.parts)),
    toolCalls: extractToolCalls(uiMessage),
  };
}

function getSandboxName(session: Session): string | null {
  const state = session.sandboxState;
  return isRecord(state) && typeof state.sandboxName === "string"
    ? state.sandboxName
    : null;
}

function getRepo(session: Session): string | null {
  return session.repoOwner && session.repoName
    ? `${session.repoOwner}/${session.repoName}`
    : null;
}

export async function buildChatDebugBundle(params: {
  session: Session;
  chat: Chat;
  eventLimit?: number;
}): Promise<ChatDebugBundle> {
  const eventLimit = Math.min(Math.max(params.eventLimit ?? 200, 1), 500);
  const [messages, events, profileRuns, workflows, services, browserRuns] =
    await Promise.all([
      getChatMessages(params.chat.id),
      listSessionEvents({
        sessionId: params.session.id,
        chatId: params.chat.id,
        limit: eventLimit,
      }),
      listManagedRuntimeProfileRuns({
        sessionId: params.session.id,
        chatId: params.chat.id,
        limit: 20,
      }),
      db.query.workflowRuns.findMany({
        where: and(
          eq(workflowRuns.sessionId, params.session.id),
          eq(workflowRuns.chatId, params.chat.id),
        ),
        orderBy: [desc(workflowRuns.createdAt)],
        limit: 20,
      }),
      params.session.runtimeMode === "managed_runtime"
        ? listManagedServices({ sessionId: params.session.id })
        : Promise.resolve([]),
      params.session.runtimeMode === "managed_runtime"
        ? listManagedBrowserRuns({
            sessionId: params.session.id,
            chatId: params.chat.id,
            limit: 20,
          })
        : Promise.resolve([]),
    ]);

  return {
    bundle: {
      kind: "chat_debug_bundle",
      version: 1,
      generatedAt: new Date().toISOString(),
      redaction: {
        status: "passed",
        notes: [
          "Secrets and token-shaped strings are redacted.",
          "Transcript text is bounded per message.",
          "Raw service log tails and artifact contents are not included.",
        ],
      },
    },
    session: {
      id: params.session.id,
      title: params.session.title,
      runtimeMode: params.session.runtimeMode,
      managedRuntimeProfileId: params.session.managedRuntimeProfileId,
      sandboxName: getSandboxName(params.session),
      lifecycleState: params.session.lifecycleState,
      repo: getRepo(params.session),
      branch: params.session.branch,
      createdAt: params.session.createdAt.toISOString(),
      updatedAt: params.session.updatedAt.toISOString(),
    },
    chat: {
      id: params.chat.id,
      title: params.chat.title,
      modelId: params.chat.modelId,
      activeStreamId: params.chat.activeStreamId,
      createdAt: params.chat.createdAt.toISOString(),
      updatedAt: params.chat.updatedAt.toISOString(),
    },
    transcript: {
      messageCount: messages.length,
      messages: messages.map(toBundleMessage),
    },
    runtime: {
      profileRuns: profileRuns.map(toManagedRuntimeProfileRunSnapshot),
      workflowRuns: workflows.map((workflow) => ({
        id: workflow.id,
        status: workflow.status,
        runtimeMode: workflow.runtimeMode,
        modelId: workflow.modelId,
        requestId: workflow.requestId,
        sandboxName: workflow.sandboxName,
        managedRuntimeProfileId: workflow.managedRuntimeProfileId,
        managedRuntimeProfileVersion: workflow.managedRuntimeProfileVersion,
        managedRuntimeProfileRunId: workflow.managedRuntimeProfileRunId,
        errorMessage: workflow.errorMessage,
        startedAt: workflow.startedAt.toISOString(),
        finishedAt: workflow.finishedAt.toISOString(),
        totalDurationMs: workflow.totalDurationMs,
        createdAt: workflow.createdAt.toISOString(),
      })),
      services,
      browserRuns,
    },
    events: events.map(toSessionEventSnapshot),
  };
}

export function renderChatDebugBundleMarkdown(bundle: ChatDebugBundle): string {
  const lines = [
    "# Chat Debug Bundle",
    "",
    `Generated: ${bundle.bundle.generatedAt}`,
    `Session: ${bundle.session.title} (${bundle.session.id})`,
    `Chat: ${bundle.chat.title} (${bundle.chat.id})`,
    `Runtime: ${bundle.session.runtimeMode}`,
    `Managed runtime profile: ${bundle.session.managedRuntimeProfileId}`,
    "",
    "## Runtime Evidence",
    "",
    `Profile runs: ${bundle.runtime.profileRuns.length}`,
    `Workflow runs: ${bundle.runtime.workflowRuns.length}`,
    `Services: ${bundle.runtime.services.length}`,
    `Browser runs: ${bundle.runtime.browserRuns.length}`,
    "",
    "## Profile Runs",
    "",
  ];

  for (const run of bundle.runtime.profileRuns) {
    lines.push(
      `- ${run.profileDisplayName} (${run.profileId}@${run.profileVersion}): ${run.status}`,
    );
    for (const result of [...run.setupResults, ...run.verificationResults]) {
      lines.push(
        `  - ${result.label}: ${result.status}${result.required === false ? " (optional)" : ""}${result.summary ? ` — ${result.summary}` : ""}`,
      );
    }
  }

  lines.push("", "## Delegated Tool Activity", "");
  for (const message of bundle.transcript.messages) {
    for (const toolCall of message.toolCalls) {
      lines.push(
        `- ${message.role} ${message.id}: ${toolCall.type}${toolCall.task ? ` — ${toolCall.task}` : ""}${toolCall.subagentType ? ` (${toolCall.subagentType})` : ""}`,
      );
    }
  }

  lines.push("", "## Events", "");
  for (const event of bundle.events) {
    lines.push(
      `- ${event.createdAt} ${event.eventName} [${event.status}]${event.summary ? `: ${event.summary}` : ""}`,
    );
  }

  lines.push("", "## Transcript Text", "");
  for (const message of bundle.transcript.messages) {
    lines.push(
      `### ${message.role} ${message.id}`,
      "",
      message.text || "(no text)",
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
