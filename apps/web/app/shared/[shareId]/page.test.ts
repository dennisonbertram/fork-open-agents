import { beforeEach, describe, expect, mock, test } from "bun:test";

const NOT_FOUND_ERROR = new Error("not-found");

let shareRecord: { id: string; chatId: string } | null = {
  id: "share-1",
  chatId: "chat-1",
};
let chatRecord: {
  id: string;
  sessionId: string;
  title: string;
  modelId: string | null;
  activeStreamId: string | null;
} | null = {
  id: "chat-1",
  sessionId: "session-1",
  title: "Debug flaky tests",
  modelId: "anthropic/claude-opus-4.6",
  activeStreamId: null,
};
let sessionRecord: {
  id: string;
  userId: string;
  title: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  cloneUrl: string | null;
  prNumber: number | null;
  prStatus: string | null;
} | null = {
  id: "session-1",
  userId: "user-1",
  title: "Session Title",
  repoOwner: "acme",
  repoName: "repo",
  branch: "main",
  cloneUrl: "https://github.com/acme/repo.git",
  prNumber: null,
  prStatus: null,
};
let messageRows: Array<{ parts: unknown; role: string; createdAt: Date }> = [
  {
    parts: { id: "m1", role: "user", parts: [] },
    role: "user",
    createdAt: new Date("2025-01-01T00:00:00Z"),
  },
];
let viewerSession: { user: { id: string } } | null = null;
let userModelVariants: Array<{
  id: string;
  name: string;
  baseModelId: string;
  providerOptions: Record<string, unknown>;
}> = [];

mock.module("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND_ERROR;
  },
}));

mock.module("@/lib/db/sessions-cache", () => ({
  getShareByIdCached: async () => shareRecord,
  getSessionByIdCached: async () => sessionRecord,
}));

mock.module("@/lib/db/client", () => ({
  db: {
    query: {
      users: {
        findFirst: async () => ({
          username: "testuser",
          name: "Test User",
          avatarUrl: "https://example.com/avatar.png",
        }),
      },
    },
  },
}));

mock.module("@/lib/db/sessions", () => ({
  getChatById: async () => chatRecord,
  getChatMessages: async () => messageRows,
}));

mock.module("@/lib/db/user-preferences", () => ({
  getUserPreferences: async () => ({
    defaultModelId: "anthropic/claude-opus-4.6",
    defaultSubagentModelId: null,
    defaultSandboxType: "vercel",
    defaultDiffMode: "unified",
    autoCommitPush: false,
    modelVariants: userModelVariants,
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => viewerSession,
}));

mock.module("./shared-chat-content", () => ({
  SharedChatContent: (_props: unknown) => null,
}));

const pageModulePromise = import("./page");

describe("/shared/[shareId] page", () => {
  beforeEach(() => {
    shareRecord = { id: "share-1", chatId: "chat-1" };
    chatRecord = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Debug flaky tests",
      modelId: "anthropic/claude-opus-4.6",
      activeStreamId: null,
    };
    sessionRecord = {
      id: "session-1",
      userId: "user-1",
      title: "Session Title",
      repoOwner: "acme",
      repoName: "repo",
      branch: "main",
      cloneUrl: "https://github.com/acme/repo.git",
      prNumber: null,
      prStatus: null,
    };
    messageRows = [
      {
        parts: { id: "m1", role: "user", parts: [] },
        role: "user",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];
    viewerSession = null;
    userModelVariants = [];
  });

  test("generateMetadata uses shared chat title", async () => {
    const { generateMetadata } = await pageModulePromise;

    const metadata = await generateMetadata({
      params: Promise.resolve({ shareId: "share-1" }),
    });

    expect(metadata.title).toBe("Debug flaky tests");
  });

  test("renders exactly one shared chat from share id mapping", async () => {
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{ chat: { id: string }; messagesWithTiming: unknown[] }>;
      };
    };

    expect(element.props.chats).toHaveLength(1);
    expect(element.props.chats[0]?.chat.id).toBe("chat-1");
    expect(element.props.chats[0]?.messagesWithTiming).toHaveLength(1);
  });

  test("passes ownerSessionHref when viewer owns the session", async () => {
    viewerSession = { user: { id: "user-1" } };
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        ownerSessionHref: string | null;
      };
    };

    expect(element.props.ownerSessionHref).toBe(
      "/sessions/session-1/chats/chat-1",
    );
  });

  test("passes custom variant name to shared chat content", async () => {
    chatRecord = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Debug flaky tests",
      modelId: "variant:abc123",
      activeStreamId: null,
    };
    userModelVariants = [
      {
        id: "variant:abc123",
        name: "Gateway Usage Variant",
        baseModelId: "openai/gpt-5.4",
        providerOptions: {
          reasoningEffort: "high",
        },
      },
    ];

    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        modelName: string | null;
      };
    };

    expect(element.props.modelName).toBe("Gateway Usage Variant");
  });

  test("redacts top-level .env tool content on shared pages", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-read",
              state: "output-available",
              input: { filePath: ".env.local" },
              output: {
                success: true,
                content: "1: SECRET=shh\n2: TOKEN=abc",
                totalLines: 2,
                startLine: 1,
                endLine: 2,
              },
            },
            {
              type: "tool-write",
              state: "output-available",
              input: {
                filePath: "apps/web/.env.example",
                content: "FOO=bar\nBAR=baz",
              },
              output: { success: true },
            },
            {
              type: "tool-edit",
              state: "output-available",
              input: {
                filePath: ".env",
                oldString: "OLD_SECRET=one",
                newString: "NEW_SECRET=two",
              },
              output: { success: true },
            },
            {
              type: "tool-write",
              state: "output-available",
              input: {
                filePath: "README.md",
                content: "visible content",
              },
              output: { success: true },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;

    expect(parts?.[0]?.output).toEqual({
      success: true,
      content: "1: [redacted from shared page]\n2: [redacted from shared page]",
      totalLines: 2,
      startLine: 1,
      endLine: 2,
    });
    expect(parts?.[1]?.input).toEqual({
      filePath: "apps/web/.env.example",
      content:
        "[content redacted from shared page]\n[content redacted from shared page]",
    });
    expect(parts?.[2]?.input).toEqual({
      filePath: ".env",
      oldString: "[previous content redacted from shared page]",
      newString: "[updated content redacted from shared page]",
    });
    expect(parts?.[3]?.input).toEqual({
      filePath: "README.md",
      content: "visible content",
    });
  });

  test("redacts nested .env tool content inside shared task output", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-task",
              state: "output-available",
              preliminary: false,
              input: {
                task: "Inspect secrets",
                subagentType: "executor",
              },
              output: {
                final: [
                  {
                    role: "assistant",
                    content: [
                      {
                        type: "tool-call",
                        toolCallId: "call-read",
                        toolName: "read",
                        input: { filePath: ".env" },
                      },
                      {
                        type: "tool-call",
                        toolCallId: "call-edit",
                        toolName: "edit",
                        input: {
                          filePath: ".env.local",
                          oldString: "SECRET=old",
                          newString: "SECRET=new",
                        },
                      },
                    ],
                  },
                  {
                    role: "tool",
                    content: [
                      {
                        type: "tool-result",
                        toolCallId: "call-read",
                        output: {
                          type: "json",
                          value: {
                            success: true,
                            content: "1: SECRET=old",
                            totalLines: 1,
                            startLine: 1,
                            endLine: 1,
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const taskPart = element.props.chats[0]?.messagesWithTiming[0]?.message
      .parts[0] as Record<string, unknown>;
    const taskOutput = taskPart.output as {
      final: Array<Record<string, unknown>>;
    };
    const nestedAssistant = taskOutput.final[0]?.content as Array<
      Record<string, unknown>
    >;
    const nestedTool = taskOutput.final[1]?.content as Array<
      Record<string, unknown>
    >;

    expect(nestedAssistant[1]?.input).toEqual({
      filePath: ".env.local",
      oldString: "[previous content redacted from shared page]",
      newString: "[updated content redacted from shared page]",
    });
    expect(nestedTool[0]?.output).toEqual({
      type: "json",
      value: {
        success: true,
        content: "1: [redacted from shared page]",
        totalLines: 1,
        startLine: 1,
        endLine: 1,
      },
    });
  });

  test("throws notFound when share mapping does not exist", async () => {
    shareRecord = null;
    const { default: SharedPage } = await pageModulePromise;

    expect(async () => {
      await SharedPage({ params: Promise.resolve({ shareId: "missing" }) });
    }).toThrow("not-found");
  });

  test("passes isStreaming=false and lastUserMessageSentAt when chat is idle", async () => {
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        isStreaming: boolean;
        lastUserMessageSentAt: string | null;
        shareId: string;
      };
    };

    expect(element.props.isStreaming).toBe(false);
    expect(element.props.lastUserMessageSentAt).toBe(
      "2025-01-01T00:00:00.000Z",
    );
    expect(element.props.shareId).toBe("share-1");
  });

  test("passes isStreaming=true when chat has an active stream", async () => {
    chatRecord = {
      id: "chat-1",
      sessionId: "session-1",
      title: "Debug flaky tests",
      modelId: "anthropic/claude-opus-4.6",
      activeStreamId: "stream-abc",
    };
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: { isStreaming: boolean; lastUserMessageSentAt: string | null };
    };

    expect(element.props.isStreaming).toBe(true);
    expect(element.props.lastUserMessageSentAt).toBe(
      "2025-01-01T00:00:00.000Z",
    );
  });

  test("lastUserMessageSentAt is null when there are no user messages", async () => {
    messageRows = [
      {
        parts: { id: "m1", role: "assistant", parts: [] },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:01:00Z"),
      },
    ];
    const { default: SharedPage } = await pageModulePromise;

    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: { lastUserMessageSentAt: string | null };
    };

    expect(element.props.lastUserMessageSentAt).toBeNull();
  });

  test("redacts tool-bash output containing a secret token on shared pages", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              state: "output-available",
              input: { command: "env" },
              output: {
                success: true,
                exitCode: 0,
                stdout:
                  "PATH=/usr/bin\nOPENAI_API_KEY=sk-1234567890123456abcdefgh\nHOME=/root",
                stderr: "",
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const bashOutput = parts?.[0]?.output as Record<string, unknown>;

    expect(bashOutput?.stdout).not.toContain("sk-1234567890123456abcdefgh");
    expect(bashOutput?.stdout).toContain("[REDACTED");
  });

  test("redacts tool-bash output containing a Bearer token on shared pages", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              state: "output-available",
              input: {
                command:
                  "curl -H 'Authorization: Bearer supersecrettoken123' https://api.example.com",
              },
              output: {
                success: true,
                exitCode: 0,
                stdout: "Response: 200 OK",
                stderr: "Authorization: Bearer supersecrettoken123",
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const bashOutput = parts?.[0]?.output as Record<string, unknown>;

    expect(bashOutput?.stderr).not.toContain("supersecrettoken123");
    expect(bashOutput?.stderr).toContain("[REDACTED]");
  });

  test("does not over-redact benign tool-bash output on shared pages", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              state: "output-available",
              input: { command: "bun test" },
              output: {
                success: true,
                exitCode: 0,
                stdout:
                  "npm install completed\n3 packages added\nDone in 1.23s",
                stderr: "",
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const bashOutput = parts?.[0]?.output as Record<string, unknown>;

    expect(bashOutput?.stdout).toBe(
      "npm install completed\n3 packages added\nDone in 1.23s",
    );
    expect(bashOutput?.exitCode).toBe(0);
    expect(bashOutput?.success).toBe(true);
  });

  test("redacts data-runtime-proof evidence strings containing secrets on shared pages", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "data-runtime-proof",
              data: {
                status: "completed",
                runtimeMode: "managed_runtime",
                workflowRunId: "run-abc",
                sandboxName: "sandbox-1",
                profile: {
                  id: "profile-1",
                  version: "1.0",
                  displayName: "Test Profile",
                  profileRunId: null,
                },
                workerEvidence: {
                  total: 1,
                  completed: 1,
                  failed: 0,
                  running: 0,
                  latest: {
                    id: "worker-1",
                    workerType: "executor",
                    status: "completed",
                    sandboxName: null,
                    profileId: null,
                    profileVersion: null,
                    profileDisplayName: null,
                    profileRunId: null,
                    currentToolName: "bash",
                    currentToolSummary:
                      "Ran: export DB_PASSWORD=hunter2supersecretvalue",
                    toolCallCount: 5,
                    summary:
                      "Completed with GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz012345",
                  },
                },
                coordinatorDirectToolUse: {
                  observed: true,
                  count: 1,
                  toolTypes: ["bash"],
                  toolLabels: [
                    "ran export DB_PASSWORD=hunter2supersecretvalue",
                  ],
                  warning:
                    "Tool output contained Bearer eyJhbGciOiJIUzI1NiJ9.secret",
                },
                evidence: [
                  "Worker ran: OPENAI_API_KEY=sk-proj-abcdef1234567890abcdef1234567890ab",
                  "No issues found",
                ],
                serviceEvidence: {
                  total: 0,
                  running: 0,
                  failed: 0,
                  latest: null,
                },
                browserEvidence: {
                  total: 0,
                  passed: 0,
                  failed: 0,
                  latest: null,
                },
                limitations: [],
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const proofPart = parts?.[0] as Record<string, unknown>;
    const data = proofPart?.data as Record<string, unknown>;
    const workerEvidence = data?.workerEvidence as Record<string, unknown>;
    const latest = workerEvidence?.latest as Record<string, unknown>;
    const coordinator = data?.coordinatorDirectToolUse as Record<
      string,
      unknown
    >;
    const evidence = data?.evidence as string[];
    const toolLabels = coordinator?.toolLabels as string[];

    // Secrets must be scrubbed
    expect(evidence[0]).not.toContain(
      "sk-proj-abcdef1234567890abcdef1234567890ab",
    );
    expect(evidence[0]).toContain("[REDACTED");
    expect(evidence[1]).toBe("No issues found");

    expect(latest?.currentToolSummary).not.toContain("hunter2supersecretvalue");
    expect(latest?.currentToolSummary).toContain("[REDACTED]");

    expect(latest?.summary).not.toContain(
      "ghp_abcdefghijklmnopqrstuvwxyz012345",
    );
    expect(latest?.summary).toContain("[REDACTED");

    expect(toolLabels[0]).not.toContain("hunter2supersecretvalue");
    expect(toolLabels[0]).toContain("[REDACTED]");

    expect(coordinator?.warning).not.toContain("eyJhbGciOiJIUzI1NiJ9.secret");
    expect(coordinator?.warning).toContain("[REDACTED]");

    // Non-secret fields unchanged
    expect(data?.workflowRunId).toBe("run-abc");
    expect(data?.status).toBe("completed");
    expect(workerEvidence?.total).toBe(1);
    expect(latest?.toolCallCount).toBe(5);
  });

  test("preserves data-runtime-proof non-secret fields unchanged on shared pages", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "data-runtime-proof",
              data: {
                status: "completed",
                runtimeMode: "managed_runtime",
                workflowRunId: "wf-xyz",
                sandboxName: null,
                profile: {
                  id: "p1",
                  version: "2.0",
                  displayName: "Safe Profile",
                  profileRunId: null,
                },
                workerEvidence: {
                  total: 0,
                  completed: 0,
                  failed: 0,
                  running: 0,
                  latest: null,
                },
                coordinatorDirectToolUse: {
                  observed: false,
                  count: 0,
                  toolTypes: [],
                  toolLabels: [],
                  warning: null,
                },
                evidence: ["All systems nominal"],
                serviceEvidence: {
                  total: 0,
                  running: 0,
                  failed: 0,
                  latest: null,
                },
                browserEvidence: {
                  total: 0,
                  passed: 0,
                  failed: 0,
                  latest: null,
                },
                limitations: [],
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const proofPart = parts?.[0] as Record<string, unknown>;
    const data = proofPart?.data as Record<string, unknown>;
    const evidence = data?.evidence as string[];

    expect(data?.status).toBe("completed");
    expect(data?.workflowRunId).toBe("wf-xyz");
    expect(evidence[0]).toBe("All systems nominal");
  });

  test("tool-bash in non-output-available state is not mutated on shared pages", async () => {
    const inputOnlyPart = {
      type: "tool-bash",
      state: "input-available",
      input: { command: "export OPENAI_API_KEY=sk-1234567890123456abcdefgh" },
    };
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [inputOnlyPart],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    // State is input-available, so no output to redact — part should be unchanged
    expect(parts?.[0]?.state).toBe("input-available");
    expect(parts?.[0]?.output).toBeUndefined();
  });

  test("tool-bash output preserves exitCode and success fields after redaction", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              state: "output-available",
              input: { command: "echo hi" },
              output: {
                success: false,
                exitCode: 127,
                stdout: "",
                stderr: "DB_PASSWORD=hunter2 command not found",
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const bashOutput = parts?.[0]?.output as Record<string, unknown>;

    // Non-string fields preserved
    expect(bashOutput?.exitCode).toBe(127);
    expect(bashOutput?.success).toBe(false);
    // Secret scrubbed from stderr
    expect(bashOutput?.stderr).not.toContain("hunter2");
    expect(bashOutput?.stderr).toContain("[REDACTED]");
  });

  test("data-runtime-proof with null workerEvidence.latest is safe on shared pages", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "data-runtime-proof",
              data: {
                status: "failed",
                runtimeMode: "managed_runtime",
                workflowRunId: "wf-null",
                sandboxName: null,
                profile: {
                  id: "p1",
                  version: "1.0",
                  displayName: "Profile",
                  profileRunId: null,
                },
                workerEvidence: {
                  total: 0,
                  completed: 0,
                  failed: 1,
                  running: 0,
                  latest: null,
                },
                coordinatorDirectToolUse: {
                  observed: false,
                  count: 0,
                  toolTypes: [],
                  toolLabels: [],
                  warning: null,
                },
                evidence: [],
                serviceEvidence: {
                  total: 0,
                  running: 0,
                  failed: 0,
                  latest: null,
                },
                browserEvidence: {
                  total: 0,
                  passed: 0,
                  failed: 0,
                  latest: null,
                },
                limitations: [],
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const proofPart = parts?.[0] as Record<string, unknown>;
    const data = proofPart?.data as Record<string, unknown>;
    const workerEvidence = data?.workerEvidence as Record<string, unknown>;

    // No crash when latest is null; status and counts preserved
    expect(data?.status).toBe("failed");
    expect(workerEvidence?.latest).toBeNull();
    expect(workerEvidence?.failed).toBe(1);
  });

  test("existing .env tool-read redaction still works after bash/proof changes", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-read",
              state: "output-available",
              input: { filePath: ".env" },
              output: {
                success: true,
                content: "1: SECRET=abc\n2: TOKEN=xyz",
                totalLines: 2,
                startLine: 1,
                endLine: 2,
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const readOutput = parts?.[0]?.output as Record<string, unknown>;

    expect(readOutput?.content).toBe(
      "1: [redacted from shared page]\n2: [redacted from shared page]",
    );
    expect(readOutput?.totalLines).toBe(2);
  });

  // ---- LEAK 1: tool-bash input.command redaction ----

  test("redacts secrets in tool-bash input.command when state is output-available", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              state: "output-available",
              input: {
                command:
                  "curl -H \"Authorization: Bearer supersecrettoken123\" https://api.example.com && mysql --password=hunter2secret && export OPENAI_API_KEY=sk-1234567890123456",
              },
              output: {
                success: true,
                exitCode: 0,
                stdout: "ok",
                stderr: "",
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const bashInput = parts?.[0]?.input as Record<string, unknown>;

    expect(bashInput?.command).not.toContain("supersecrettoken123");
    expect(bashInput?.command).not.toContain("hunter2secret");
    expect(bashInput?.command).not.toContain("sk-1234567890123456");
    // Payload-level assertion: raw secrets must not appear anywhere in the serialized props
    expect(JSON.stringify(element.props)).not.toContain("supersecrettoken123");
    expect(JSON.stringify(element.props)).not.toContain("hunter2secret");
    expect(JSON.stringify(element.props)).not.toContain("sk-1234567890123456");
  });

  test("redacts secrets in tool-bash input.command when state is input-available", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              state: "input-available",
              input: {
                command:
                  "export OPENAI_API_KEY=sk-1234567890123456 && curl -H \"Authorization: Bearer supersecrettoken123\" https://api.example.com",
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const bashInput = parts?.[0]?.input as Record<string, unknown>;

    expect(bashInput?.command).not.toContain("sk-1234567890123456");
    expect(bashInput?.command).not.toContain("supersecrettoken123");
    // Payload-level: raw secrets absent from entire serialized props
    expect(JSON.stringify(element.props)).not.toContain("sk-1234567890123456");
    expect(JSON.stringify(element.props)).not.toContain("supersecrettoken123");
  });

  test("strengthens existing Bearer test: command is scrubbed AND payload is clean", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              state: "output-available",
              input: {
                command:
                  "curl -H 'Authorization: Bearer supersecrettoken123' https://api.example.com",
              },
              output: {
                success: true,
                exitCode: 0,
                stdout: "Response: 200 OK",
                stderr: "Authorization: Bearer supersecrettoken123",
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const bashInput = parts?.[0]?.input as Record<string, unknown>;
    const bashOutput = parts?.[0]?.output as Record<string, unknown>;

    // input.command must be scrubbed (the new surface)
    expect(bashInput?.command).not.toContain("supersecrettoken123");
    // stderr must still be scrubbed (existing surface)
    expect(bashOutput?.stderr).not.toContain("supersecrettoken123");
    // Payload-level assertion: nowhere in serialized props
    expect(JSON.stringify(element.props)).not.toContain("supersecrettoken123");
  });

  // ---- LEAK 2: data-runtime-proof missed fields ----

  test("redacts limitations[], serviceEvidence.latest and browserEvidence.latest free-text fields in data-runtime-proof", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "data-runtime-proof",
              data: {
                status: "completed",
                runtimeMode: "managed_runtime",
                workflowRunId: "wf-leak2",
                sandboxName: null,
                profile: {
                  id: "p1",
                  version: "1.0",
                  displayName: "Test",
                  profileRunId: null,
                },
                workerEvidence: {
                  total: 0,
                  completed: 0,
                  failed: 0,
                  running: 0,
                  latest: null,
                },
                coordinatorDirectToolUse: {
                  observed: false,
                  count: 0,
                  toolTypes: [],
                  toolLabels: [],
                  warning: null,
                },
                evidence: [],
                serviceEvidence: {
                  total: 1,
                  running: 0,
                  failed: 1,
                  latest: {
                    id: "svc-1",
                    kind: "postgres",
                    status: "failed",
                    packagePath: "/app/db",
                    port: 5432,
                    url: "postgres://admin:hunter2pw@db.internal:5432/prod",
                    logPath:
                      "/var/log/secret-OPENAI_API_KEY=sk-svclogpath123456789/service.log",
                    lastHealthStatus: 500,
                    failureMessage:
                      "Connection failed with password=hunter2pw and token Bearer svcfailtoken456",
                  },
                },
                browserEvidence: {
                  total: 1,
                  passed: 0,
                  failed: 1,
                  latest: {
                    id: "browser-1",
                    status: "failed",
                    targetUrl: "https://user:p4ssw0rd@x.com/path",
                    summary:
                      "Authentication failed: Bearer browserjwttoken789 was rejected",
                    artifactCount: 0,
                    redactionStatus: "none",
                  },
                },
                limitations: [
                  "Warning: Bearer warninglimittoken111 found in output",
                  "No further issues",
                ],
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const proofPart = parts?.[0] as Record<string, unknown>;
    const data = proofPart?.data as Record<string, unknown>;
    const serviceEvidence = data?.serviceEvidence as Record<string, unknown>;
    const svcLatest = serviceEvidence?.latest as Record<string, unknown>;
    const browserEvidence = data?.browserEvidence as Record<string, unknown>;
    const browserLatest = browserEvidence?.latest as Record<string, unknown>;
    const limitations = data?.limitations as string[];

    // serviceEvidence.latest.url — credentials stripped
    expect(svcLatest?.url).not.toContain("hunter2pw");
    expect(typeof svcLatest?.url).toBe("string");

    // serviceEvidence.latest.failureMessage — secret scrubbed
    expect(svcLatest?.failureMessage).not.toContain("hunter2pw");
    expect(svcLatest?.failureMessage).not.toContain("svcfailtoken456");

    // serviceEvidence.latest.logPath — secret scrubbed
    expect(svcLatest?.logPath).not.toContain("sk-svclogpath123456789");

    // browserEvidence.latest.targetUrl — credentials stripped
    expect(browserLatest?.targetUrl).not.toContain("p4ssw0rd");
    expect(typeof browserLatest?.targetUrl).toBe("string");

    // browserEvidence.latest.summary — Bearer token scrubbed
    expect(browserLatest?.summary).not.toContain("browserjwttoken789");

    // limitations[] — Bearer token scrubbed
    expect(limitations[0]).not.toContain("warninglimittoken111");
    expect(limitations[1]).toBe("No further issues");

    // Structural fields preserved
    expect(data?.workflowRunId).toBe("wf-leak2");
    expect(data?.status).toBe("completed");
    expect(serviceEvidence?.total).toBe(1);
    expect(svcLatest?.id).toBe("svc-1");
    expect(svcLatest?.kind).toBe("postgres");
    expect(svcLatest?.port).toBe(5432);
    expect(svcLatest?.status).toBe("failed");
    expect(browserLatest?.id).toBe("browser-1");
    expect(browserLatest?.status).toBe("failed");
    expect(browserLatest?.artifactCount).toBe(0);
    expect(browserLatest?.redactionStatus).toBe("none");

    // Payload-level assertion: no raw secrets anywhere in serialized props
    expect(JSON.stringify(element.props)).not.toContain("hunter2pw");
    expect(JSON.stringify(element.props)).not.toContain("svcfailtoken456");
    expect(JSON.stringify(element.props)).not.toContain("sk-svclogpath123456789");
    expect(JSON.stringify(element.props)).not.toContain("p4ssw0rd");
    expect(JSON.stringify(element.props)).not.toContain("browserjwttoken789");
    expect(JSON.stringify(element.props)).not.toContain("warninglimittoken111");
  });

  test("null-safety: data-runtime-proof with null serviceEvidence.latest and browserEvidence.latest and empty limitations does not crash", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "data-runtime-proof",
              data: {
                status: "completed",
                runtimeMode: "managed_runtime",
                workflowRunId: "wf-null2",
                sandboxName: null,
                profile: {
                  id: "p1",
                  version: "1.0",
                  displayName: "Profile",
                  profileRunId: null,
                },
                workerEvidence: {
                  total: 0,
                  completed: 0,
                  failed: 0,
                  running: 0,
                  latest: null,
                },
                coordinatorDirectToolUse: {
                  observed: false,
                  count: 0,
                  toolTypes: [],
                  toolLabels: [],
                  warning: null,
                },
                evidence: [],
                serviceEvidence: {
                  total: 0,
                  running: 0,
                  failed: 0,
                  latest: null,
                },
                browserEvidence: {
                  total: 0,
                  passed: 0,
                  failed: 0,
                  latest: null,
                },
                limitations: [],
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const proofPart = parts?.[0] as Record<string, unknown>;
    const data = proofPart?.data as Record<string, unknown>;
    const serviceEvidence = data?.serviceEvidence as Record<string, unknown>;
    const browserEvidence = data?.browserEvidence as Record<string, unknown>;
    const limitations = data?.limitations as unknown[];

    // No crash; null latest preserved; empty arrays preserved
    expect(serviceEvidence?.latest).toBeNull();
    expect(browserEvidence?.latest).toBeNull();
    expect(limitations).toHaveLength(0);
    expect(data?.status).toBe("completed");
  });

  test("limitations[] duplicates the warning-via-limitations bypass: warning in limitations is also scrubbed", async () => {
    messageRows = [
      {
        parts: {
          id: "m1",
          role: "assistant",
          parts: [
            {
              type: "data-runtime-proof",
              data: {
                status: "completed",
                runtimeMode: "managed_runtime",
                workflowRunId: "wf-dup",
                sandboxName: null,
                profile: {
                  id: "p1",
                  version: "1.0",
                  displayName: "Profile",
                  profileRunId: null,
                },
                workerEvidence: {
                  total: 0,
                  completed: 0,
                  failed: 0,
                  running: 0,
                  latest: null,
                },
                coordinatorDirectToolUse: {
                  observed: true,
                  count: 1,
                  toolTypes: ["bash"],
                  toolLabels: [],
                  warning:
                    "Tool output contained Bearer dupwarningtoken999",
                },
                evidence: [],
                serviceEvidence: {
                  total: 0,
                  running: 0,
                  failed: 0,
                  latest: null,
                },
                browserEvidence: {
                  total: 0,
                  passed: 0,
                  failed: 0,
                  latest: null,
                },
                // warning text duplicated into limitations (as happens in the app)
                limitations: [
                  "Tool output contained Bearer dupwarningtoken999",
                ],
              },
            },
          ],
        },
        role: "assistant",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      },
    ];

    const { default: SharedPage } = await pageModulePromise;
    const element = (await SharedPage({
      params: Promise.resolve({ shareId: "share-1" }),
    })) as {
      props: {
        chats: Array<{
          messagesWithTiming: Array<{
            message: { parts: Array<Record<string, unknown>> };
          }>;
        }>;
      };
    };

    const parts = element.props.chats[0]?.messagesWithTiming[0]?.message.parts;
    const proofPart = parts?.[0] as Record<string, unknown>;
    const data = proofPart?.data as Record<string, unknown>;
    const coordinator = data?.coordinatorDirectToolUse as Record<
      string,
      unknown
    >;
    const limitations = data?.limitations as string[];

    // coordinatorDirectToolUse.warning must be scrubbed (existing)
    expect(coordinator?.warning).not.toContain("dupwarningtoken999");
    // limitations[] duplicate must ALSO be scrubbed (the bypass vector)
    expect(limitations[0]).not.toContain("dupwarningtoken999");
    // Payload-level: nowhere in serialized props
    expect(JSON.stringify(element.props)).not.toContain("dupwarningtoken999");
  });
});
