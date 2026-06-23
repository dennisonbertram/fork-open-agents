import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BackgroundAgentDraftOutput } from "@/lib/background-agents/draft";

type GenerateTextInput = {
  model: unknown;
  output: unknown;
  prompt: string;
};

const generateTextCalls: GenerateTextInput[] = [];

let currentSession: { user: { id: string } } | null = {
  user: { id: "user-1" },
};

let generateTextResult:
  | { output: BackgroundAgentDraftOutput; usage?: { outputTokens?: number } }
  | Error = {
  output: {
    name: "Issue triage",
    goal: "Triage newly opened issues.",
    triggerKind: "github.issue",
    instructions:
      "When a new issue is opened, read the title and body, apply useful labels, and leave a short triage note. Do not close the issue.",
    outputMode: "none",
    checkCommand: "",
    schedule: "",
    conditions: {
      actions: ["opened"],
      labels: ["bug"],
    },
  },
};

mock.module("ai", () => ({
  Output: {
    object: (input: unknown) => ({ kind: "object", input }),
  },
  generateText: async (input: GenerateTextInput) => {
    generateTextCalls.push(input);
    if (generateTextResult instanceof Error) {
      throw generateTextResult;
    }
    return generateTextResult;
  },
}));

mock.module("@open-agents/agent", () => ({
  gateway: (modelId: string) => ({ modelId }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => currentSession,
}));

mock.module("@/lib/botid", () => ({
  checkBotProtection: async () => ({ isBot: false }),
}));

mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: async () => null,
  rateLimitKey: (parts: Array<number | string | null | undefined>) =>
    parts.filter((part) => part !== null && part !== undefined).join(":"),
}));

const routeModulePromise = import("./route");

function createJsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/background-agents/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/background-agents/draft", () => {
  beforeEach(() => {
    currentSession = { user: { id: "user-1" } };
    generateTextCalls.length = 0;
    generateTextResult = {
      output: {
        name: "Issue triage",
        goal: "Triage newly opened issues.",
        triggerKind: "github.issue",
        instructions:
          "When a new issue is opened, read the title and body, apply useful labels, and leave a short triage note. Do not close the issue.",
        outputMode: "none",
        checkCommand: "",
        schedule: "",
        conditions: {
          actions: ["opened"],
          labels: ["bug"],
        },
      },
    };
  });

  test("returns 401 when the user is not authenticated", async () => {
    currentSession = null;
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        description: "label new issues",
        repoOwner: "acme",
        repoName: "widgets",
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Not authenticated");
    expect(generateTextCalls).toHaveLength(0);
  });

  test("returns 400 when the description is missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({ repoOwner: "acme", repoName: "widgets" }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("Describe the agent you want first.");
    expect(generateTextCalls).toHaveLength(0);
  });

  test("returns a normalized editor draft for a valid request", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        description: "When a new issue is opened, label it and comment.",
        repoOwner: "acme",
        repoName: "widgets",
      }),
    );
    const body = (await response.json()) as {
      draft: {
        name: string;
        triggerKind: string;
        conditionActions: string;
        conditionLabels: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.draft.name).toBe("Issue triage");
    expect(body.draft.triggerKind).toBe("github.issue");
    expect(body.draft.conditionActions).toBe("opened");
    expect(body.draft.conditionLabels).toBe("bug");
    expect(generateTextCalls).toHaveLength(1);
    expect(generateTextCalls[0]?.model).toEqual({
      modelId: "anthropic/claude-haiku-4.5",
    });
    expect(generateTextCalls[0]?.prompt).toContain("acme/widgets");
    expect(generateTextCalls[0]?.prompt).toContain(
      "When a new issue is opened",
    );
  });

  test("returns 502 when generation fails", async () => {
    generateTextResult = new Error("model unavailable");
    const { POST } = await routeModulePromise;

    const response = await POST(
      createJsonRequest({
        description: "When CI fails on a pull request, propose a fix.",
        repoOwner: "acme",
        repoName: "widgets",
      }),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe("Couldn't generate an agent spec. Try again.");
  });
});
