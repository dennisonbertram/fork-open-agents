import { describe, expect, test } from "bun:test";
import { createBackgroundAgentSchema } from "../lib/background-agents/types";
import {
  assertAgentDisabled,
  assertAgentEnabled,
  BackgroundAgentJourneyProofError,
  buildJourneyAgentPayload,
  getJourneyConfig,
  parseAgentListIds,
  parseCreatedAgent,
  runJourney,
  type JourneyConfig,
} from "./background-agent-journey-proof";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    BACKGROUND_AGENT_PROOF_BASE_URL: "https://open-agents.example",
    BACKGROUND_AGENT_PROOF_COOKIE: "open_agents_test_user_id=dev-user",
    BACKGROUND_AGENT_JOURNEY_REPO_OWNER: "acme",
    BACKGROUND_AGENT_JOURNEY_REPO_NAME: "disposable",
    ...overrides,
  };
}

function baseConfig(overrides: Partial<JourneyConfig> = {}): JourneyConfig {
  return {
    baseUrl: new URL("https://open-agents.example"),
    cookie: "open_agents_test_user_id=dev-user",
    repoOwner: "acme",
    repoName: "disposable",
    timeoutMs: 5000,
    pollIntervalMs: 1,
    requireSucceeded: false,
    ...overrides,
  };
}

type Router = (method: string, pathname: string) => Response | Promise<Response>;

function makeFetch(router: Router, recorded: Array<{ method: string; url: string; headers: Headers }>) {
  return (async (url: string | URL, init?: RequestInit) => {
    const parsed = new URL(url);
    const method = init?.method ?? "GET";
    recorded.push({
      method,
      url: parsed.pathname,
      headers: new Headers(init?.headers),
    });
    return router(method, parsed.pathname);
  }) as typeof fetch;
}

describe("background-agent-journey-proof", () => {
  describe("getJourneyConfig", () => {
    test("builds config from env with defaults", () => {
      const config = getJourneyConfig(baseEnv());
      expect(config.baseUrl.origin).toBe("https://open-agents.example");
      expect(config.cookie).toBe("open_agents_test_user_id=dev-user");
      expect(config.repoOwner).toBe("acme");
      expect(config.repoName).toBe("disposable");
      expect(config.timeoutMs).toBe(120_000);
      expect(config.pollIntervalMs).toBe(2000);
      expect(config.requireSucceeded).toBe(false);
      expect(config.bypassSecret).toBeUndefined();
    });

    test("honors an overridden timeout", () => {
      const config = getJourneyConfig(
        baseEnv({ BACKGROUND_AGENT_JOURNEY_TIMEOUT_MS: "30000" }),
      );
      expect(config.timeoutMs).toBe(30_000);
    });

    test("fails fast when required env is missing", () => {
      expect(() => getJourneyConfig({})).toThrow(
        BackgroundAgentJourneyProofError,
      );
      expect(() =>
        getJourneyConfig(
          baseEnv({ BACKGROUND_AGENT_JOURNEY_REPO_OWNER: undefined }),
        ),
      ).toThrow(BackgroundAgentJourneyProofError);
      expect(() =>
        getJourneyConfig(
          baseEnv({ BACKGROUND_AGENT_JOURNEY_REPO_NAME: undefined }),
        ),
      ).toThrow(BackgroundAgentJourneyProofError);
      expect(() =>
        getJourneyConfig(baseEnv({ BACKGROUND_AGENT_PROOF_COOKIE: undefined })),
      ).toThrow(BackgroundAgentJourneyProofError);
    });

    test("rejects a non-http(s) base URL", () => {
      expect(() =>
        getJourneyConfig(
          baseEnv({ BACKGROUND_AGENT_PROOF_BASE_URL: "ftp://x.example" }),
        ),
      ).toThrow(BackgroundAgentJourneyProofError);
    });

    test("does not require an existing agent id", () => {
      expect(() => getJourneyConfig(baseEnv())).not.toThrow();
    });
  });

  describe("buildJourneyAgentPayload", () => {
    test("produces a payload that satisfies the create schema", () => {
      const payload = buildJourneyAgentPayload({
        repoOwner: "acme",
        repoName: "disposable",
      });
      const parsed = createBackgroundAgentSchema.parse(payload);

      expect(parsed.status).toBe("disabled");
      expect(parsed.githubActions).toEqual({});
      expect(parsed.triggers).toHaveLength(1);
      expect(parsed.triggers[0].kind).toBe("github.issue");
      expect(parsed.triggers[0].status).toBe("enabled");
      expect(parsed.triggers[0].conditions.labels).toEqual([
        "journey-proof-never",
      ]);
      expect(parsed.name.length).toBeLessThanOrEqual(100);
      expect(parsed.instructions.length).toBeGreaterThan(0);
    });
  });

  describe("parseCreatedAgent / assertions / parseAgentListIds", () => {
    test("parses a valid created-agent response", () => {
      const agent = parseCreatedAgent({
        agent: { id: "agent-j1", status: "disabled" },
      });
      expect(agent.id).toBe("agent-j1");
      expect(agent.status).toBe("disabled");
    });

    test("rejects a malformed created-agent response", () => {
      expect(() => parseCreatedAgent(null)).toThrow(
        BackgroundAgentJourneyProofError,
      );
      expect(() => parseCreatedAgent({ agent: { id: 1 } })).toThrow(
        BackgroundAgentJourneyProofError,
      );
    });

    test("assertAgentDisabled/assertAgentEnabled guard status", () => {
      expect(() =>
        assertAgentDisabled({ id: "a1", status: "disabled" }),
      ).not.toThrow();
      expect(() =>
        assertAgentDisabled({ id: "a1", status: "enabled" }),
      ).toThrow(BackgroundAgentJourneyProofError);
      expect(() =>
        assertAgentEnabled({ id: "a1", status: "enabled" }),
      ).not.toThrow();
      expect(() =>
        assertAgentEnabled({ id: "a1", status: "disabled" }),
      ).toThrow(BackgroundAgentJourneyProofError);
    });

    test("parseAgentListIds extracts ids from a list response", () => {
      const ids = parseAgentListIds({
        agents: [{ id: "a1" }, { id: "a2" }],
      });
      expect(ids).toEqual(["a1", "a2"]);
    });
  });

  describe("runJourney", () => {
    test("happy path: create -> confirm-disabled -> enable -> dispatch -> poll -> cleanup", async () => {
      const config = baseConfig();
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      let runCallCount = 0;
      const router: Router = (method, pathname) => {
        if (method === "POST" && pathname === "/api/background-agents") {
          return jsonResponse(201, {
            agent: { id: "agent-j1", status: "disabled" },
          });
        }
        if (
          method === "PATCH" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, {
            agent: { id: "agent-j1", status: "enabled" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/background-agents/agent-j1/test"
        ) {
          return jsonResponse(200, {
            enabled: true,
            matched: 1,
            created: 1,
            duplicates: 0,
            runIds: ["run-1"],
            loopRunIds: [],
          });
        }
        if (
          method === "GET" &&
          pathname === "/api/background-agent-runs/run-1"
        ) {
          runCallCount += 1;
          if (runCallCount === 1) {
            return jsonResponse(200, {
              run: { id: "run-1", status: "running" },
              events: [],
              outputs: [],
            });
          }
          return jsonResponse(200, {
            run: { id: "run-1", status: "succeeded" },
            events: [{ eventName: "background-agent.workflow.started" }],
            outputs: [],
          });
        }
        if (
          method === "DELETE" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/background-agents") {
          return jsonResponse(200, { agents: [] });
        }
        throw new Error(`Unexpected request: ${method} ${pathname}`);
      };
      const fetchImpl = makeFetch(router, recorded);
      const logLines: string[] = [];

      const summary = await runJourney(config, {
        fetchImpl,
        log: (line) => logLines.push(line),
      });

      expect(summary.journey).toBe("passed");
      expect(summary.cleanup).toBe("deleted");
      expect(summary.agentId).toBe("agent-j1");
      expect(summary.runId).toBe("run-1");
      expect(summary.runStatus).toBe("succeeded");

      expect(recorded.map((r) => `${r.method} ${r.url}`)).toEqual([
        "POST /api/background-agents",
        "PATCH /api/background-agents/agent-j1",
        "POST /api/background-agents/agent-j1/test",
        "GET /api/background-agent-runs/run-1",
        "GET /api/background-agent-runs/run-1",
        "DELETE /api/background-agents/agent-j1",
        "GET /api/background-agents",
      ]);
      for (const call of recorded) {
        expect(call.headers.get("Cookie")).toBe(
          "open_agents_test_user_id=dev-user",
        );
      }

      const createBody = recorded[0];
      expect(createBody).toBeDefined();

      const summaryLine = logLines.find((line) =>
        line.startsWith("journey-summary: "),
      );
      expect(summaryLine).toBeDefined();
    });

    test("sends the vercel protection bypass headers when configured", async () => {
      const config = baseConfig({ bypassSecret: "bypass-secret" });
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const router: Router = (method, pathname) => {
        if (method === "POST" && pathname === "/api/background-agents") {
          return jsonResponse(201, {
            agent: { id: "agent-j1", status: "disabled" },
          });
        }
        if (
          method === "PATCH" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, {
            agent: { id: "agent-j1", status: "enabled" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/background-agents/agent-j1/test"
        ) {
          return jsonResponse(500, { error: "boom" });
        }
        if (
          method === "DELETE" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/background-agents") {
          return jsonResponse(200, { agents: [] });
        }
        throw new Error(`Unexpected request: ${method} ${pathname}`);
      };
      const fetchImpl = makeFetch(router, recorded);

      await runJourney(config, { fetchImpl });

      expect(recorded[0].headers.get("x-vercel-protection-bypass")).toBe(
        "bypass-secret",
      );
    });

    test("hard deadline: still-running poll is a journey failure, but cleanup still runs", async () => {
      const config = baseConfig({ timeoutMs: 10, pollIntervalMs: 1 });
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const router: Router = (method, pathname) => {
        if (method === "POST" && pathname === "/api/background-agents") {
          return jsonResponse(201, {
            agent: { id: "agent-j1", status: "disabled" },
          });
        }
        if (
          method === "PATCH" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, {
            agent: { id: "agent-j1", status: "enabled" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/background-agents/agent-j1/test"
        ) {
          return jsonResponse(200, {
            enabled: true,
            matched: 1,
            created: 1,
            duplicates: 0,
            runIds: ["run-1"],
          });
        }
        if (
          method === "GET" &&
          pathname === "/api/background-agent-runs/run-1"
        ) {
          return jsonResponse(200, {
            run: { id: "run-1", status: "running" },
            events: [],
            outputs: [],
          });
        }
        if (
          method === "DELETE" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/background-agents") {
          return jsonResponse(200, { agents: [] });
        }
        throw new Error(`Unexpected request: ${method} ${pathname}`);
      };
      const fetchImpl = makeFetch(router, recorded);

      const summary = await runJourney(config, { fetchImpl });

      expect(summary.journey).toBe("failed");
      expect(summary.failedStep).toContain("poll");
      expect(summary.cleanup).toBe("deleted");
      expect(
        recorded.some(
          (r) =>
            r.method === "DELETE" && r.url === "/api/background-agents/agent-j1",
        ),
      ).toBe(true);
    });

    test("mid-journey failure (dispatch 500) still runs cleanup", async () => {
      const config = baseConfig();
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const router: Router = (method, pathname) => {
        if (method === "POST" && pathname === "/api/background-agents") {
          return jsonResponse(201, {
            agent: { id: "agent-j1", status: "disabled" },
          });
        }
        if (
          method === "PATCH" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, {
            agent: { id: "agent-j1", status: "enabled" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/background-agents/agent-j1/test"
        ) {
          return jsonResponse(500, { error: "boom" });
        }
        if (
          method === "DELETE" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/background-agents") {
          return jsonResponse(200, { agents: [] });
        }
        throw new Error(`Unexpected request: ${method} ${pathname}`);
      };
      const fetchImpl = makeFetch(router, recorded);

      const summary = await runJourney(config, { fetchImpl });

      expect(summary.journey).toBe("failed");
      expect(summary.cleanup).toBe("deleted");
    });

    test("cleanup failure after journey success is a warning, not a failure exit", async () => {
      const config = baseConfig();
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      let runCallCount = 0;
      const router: Router = (method, pathname) => {
        if (method === "POST" && pathname === "/api/background-agents") {
          return jsonResponse(201, {
            agent: { id: "agent-j1", status: "disabled" },
          });
        }
        if (
          method === "PATCH" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, {
            agent: { id: "agent-j1", status: "enabled" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/background-agents/agent-j1/test"
        ) {
          return jsonResponse(200, {
            enabled: true,
            matched: 1,
            created: 1,
            duplicates: 0,
            runIds: ["run-1"],
          });
        }
        if (
          method === "GET" &&
          pathname === "/api/background-agent-runs/run-1"
        ) {
          runCallCount += 1;
          if (runCallCount === 1) {
            return jsonResponse(200, {
              run: { id: "run-1", status: "running" },
              events: [],
              outputs: [],
            });
          }
          return jsonResponse(200, {
            run: { id: "run-1", status: "succeeded" },
            events: [{ eventName: "background-agent.workflow.started" }],
            outputs: [],
          });
        }
        if (
          method === "DELETE" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(500, { error: "boom" });
        }
        throw new Error(`Unexpected request: ${method} ${pathname}`);
      };
      const fetchImpl = makeFetch(router, recorded);
      const logLines: string[] = [];

      const summary = await runJourney(config, {
        fetchImpl,
        log: (line) => logLines.push(line),
      });

      expect(summary.journey).toBe("passed");
      expect(summary.cleanup).toBe("failed");
      expect(
        logLines.some(
          (line) => line.includes("WARNING: cleanup failed") &&
            line.includes("agent-j1"),
        ),
      ).toBe(true);
    });

    test("confirm-disabled guard fails the journey but still cleans up", async () => {
      const config = baseConfig();
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const router: Router = (method, pathname) => {
        if (method === "POST" && pathname === "/api/background-agents") {
          return jsonResponse(201, {
            agent: { id: "agent-j1", status: "enabled" },
          });
        }
        if (
          method === "DELETE" &&
          pathname === "/api/background-agents/agent-j1"
        ) {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/background-agents") {
          return jsonResponse(200, { agents: [] });
        }
        throw new Error(`Unexpected request: ${method} ${pathname}`);
      };
      const fetchImpl = makeFetch(router, recorded);

      const summary = await runJourney(config, { fetchImpl });

      expect(summary.journey).toBe("failed");
      expect(summary.failedStep).toBe("confirm-disabled");
      expect(
        recorded.some(
          (r) =>
            r.method === "DELETE" && r.url === "/api/background-agents/agent-j1",
        ),
      ).toBe(true);
    });
  });
});
