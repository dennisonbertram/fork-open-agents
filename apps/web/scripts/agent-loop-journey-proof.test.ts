import { describe, expect, test } from "bun:test";
import { createAgentLoopBodySchema } from "../lib/agent-loops/request-schemas";
import { validateLoopDefinition } from "../lib/agent-loops/validation";
import {
  AgentLoopJourneyProofError,
  assertLoopProofRun,
  buildJourneyLoopPayload,
  getJourneyConfig,
  isTerminalLoopStatus,
  parseCreatedLoop,
  parseRunDetail,
  runJourney,
  type JourneyConfig,
} from "./agent-loop-journey-proof";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    LOOP_JOURNEY_PROOF_BASE_URL: "https://open-agents.example",
    LOOP_JOURNEY_PROOF_COOKIE: "open_agents_test_user_id=dev-user",
    LOOP_JOURNEY_PROOF_REPO_OWNER: "acme",
    LOOP_JOURNEY_PROOF_REPO_NAME: "disposable",
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

type Router = (
  method: string,
  pathname: string,
) => Response | Promise<Response>;

function makeFetch(
  router: Router,
  recorded: Array<{ method: string; url: string; headers: Headers }>,
) {
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

describe("agent-loop-journey-proof", () => {
  describe("getJourneyConfig", () => {
    test("builds config from env with defaults", () => {
      const config = getJourneyConfig(baseEnv());
      expect(config.baseUrl.origin).toBe("https://open-agents.example");
      expect(config.cookie).toBe("open_agents_test_user_id=dev-user");
      expect(config.repoOwner).toBe("acme");
      expect(config.repoName).toBe("disposable");
      expect(config.timeoutMs).toBe(1_200_000);
      expect(config.pollIntervalMs).toBe(2000);
      expect(config.requireSucceeded).toBe(false);
      expect(config.bypassSecret).toBeUndefined();
    });

    test("honors an overridden timeout and poll interval", () => {
      const config = getJourneyConfig(
        baseEnv({
          LOOP_JOURNEY_PROOF_TIMEOUT_MS: "30000",
          LOOP_JOURNEY_PROOF_POLL_MS: "500",
        }),
      );
      expect(config.timeoutMs).toBe(30_000);
      expect(config.pollIntervalMs).toBe(500);
    });

    test.each([
      "LOOP_JOURNEY_PROOF_BASE_URL",
      "LOOP_JOURNEY_PROOF_COOKIE",
      "LOOP_JOURNEY_PROOF_REPO_OWNER",
      "LOOP_JOURNEY_PROOF_REPO_NAME",
    ])("throws when %s is missing", (name) => {
      const env = baseEnv({ [name]: undefined });
      delete env[name as keyof typeof env];
      expect(() => getJourneyConfig(env)).toThrow(AgentLoopJourneyProofError);
    });

    test("rejects a non-http(s) base url", () => {
      expect(() =>
        getJourneyConfig(
          baseEnv({ LOOP_JOURNEY_PROOF_BASE_URL: "ftp://example.com" }),
        ),
      ).toThrow(AgentLoopJourneyProofError);
    });
  });

  describe("buildJourneyLoopPayload", () => {
    const payload = buildJourneyLoopPayload({
      repoOwner: "acme",
      repoName: "disposable",
    }) as Record<string, unknown>;

    test("produces a valid loop definition", () => {
      const result = validateLoopDefinition(payload.definition);
      expect(result.ok).toBe(true);
    });

    test("parses against createAgentLoopBodySchema", () => {
      expect(() => createAgentLoopBodySchema.parse(payload)).not.toThrow();
    });

    test("omits status so the store defaults to draft", () => {
      expect(payload.status).toBeUndefined();
    });

    test("has the exact deterministic guardrails", () => {
      expect(payload.guardrails).toEqual({
        maxStepsPerRun: 5,
        maxIterations: 1,
        maxRunDurationMs: 1_080_000,
        stepTimeoutMs: 900_000,
        maxAgentTurnsPerStep: 4,
      });
    });

    test("has exactly one report-only agent_step node with no write scopes", () => {
      const definition = payload.definition as {
        nodes: Array<Record<string, unknown>>;
      };
      const agentSteps = definition.nodes.filter(
        (node) => node.kind === "agent_step",
      );
      expect(agentSteps).toHaveLength(1);
      const step = agentSteps[0];
      expect(String(step.instructions)).toContain("Do not modify");
      expect(step.composioToolkitSlugs).toBeUndefined();
      const permissions = step.permissions as
        | { github?: Record<string, string> }
        | undefined;
      const writeValues = Object.values(permissions?.github ?? {});
      expect(writeValues).not.toContain("write");
    });
  });

  describe("isTerminalLoopStatus", () => {
    test.each(["completed", "failed", "cancelled", "stalled"])(
      "%s is terminal",
      (status) => {
        expect(isTerminalLoopStatus(status)).toBe(true);
      },
    );

    test.each(["queued", "running", "paused"])(
      "%s is not terminal",
      (status) => {
        expect(isTerminalLoopStatus(status)).toBe(false);
      },
    );
  });

  describe("parseCreatedLoop / parseRunDetail", () => {
    test("rejects malformed create response", () => {
      expect(() => parseCreatedLoop(null)).toThrow(AgentLoopJourneyProofError);
      expect(() => parseCreatedLoop({})).toThrow(AgentLoopJourneyProofError);
      expect(() =>
        parseCreatedLoop({ loop: { id: 1, status: "draft" } }),
      ).toThrow(AgentLoopJourneyProofError);
    });

    test("rejects malformed run detail response", () => {
      expect(() => parseRunDetail(null)).toThrow(AgentLoopJourneyProofError);
      expect(() => parseRunDetail({})).toThrow(AgentLoopJourneyProofError);
    });

    test("extracts eventNames from events[*].eventName", () => {
      const detail = parseRunDetail({
        run: { id: "run-1", status: "completed" },
        steps: [],
        events: [
          { eventName: "agent-loop.run.started" },
          { eventName: "agent-loop.run.completed" },
        ],
      });
      expect(detail.eventNames).toEqual([
        "agent-loop.run.started",
        "agent-loop.run.completed",
      ]);
    });
  });

  describe("assertLoopProofRun", () => {
    function makeDetail(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        run: { id: "run-1", status: "completed", ...overrides },
        steps: [],
        eventNames: ["agent-loop.run.started"],
      } as unknown as ReturnType<typeof parseRunDetail>;
    }

    test("throws on dispatch_failed errorKind", () => {
      const detail = makeDetail({ errorKind: "dispatch_failed" });
      expect(() => assertLoopProofRun(detail, {})).toThrow(
        AgentLoopJourneyProofError,
      );
    });

    test("throws on turn_budget_exceeded on the run", () => {
      const detail = makeDetail({ errorKind: "turn_budget_exceeded" });
      expect(() => assertLoopProofRun(detail, {})).toThrow(
        AgentLoopJourneyProofError,
      );
    });

    test("throws on turn_budget_exceeded on any step", () => {
      const detail = {
        run: { id: "run-1", status: "completed" },
        steps: [{ errorKind: "turn_budget_exceeded" }],
        eventNames: ["agent-loop.run.started"],
      } as unknown as ReturnType<typeof parseRunDetail>;
      expect(() => assertLoopProofRun(detail, {})).toThrow(
        AgentLoopJourneyProofError,
      );
    });

    test("throws when events present without a started event", () => {
      const detail = {
        run: { id: "run-1", status: "completed" },
        steps: [],
        eventNames: ["agent-loop.run.completed"],
      } as unknown as ReturnType<typeof parseRunDetail>;
      expect(() => assertLoopProofRun(detail, {})).toThrow(
        AgentLoopJourneyProofError,
      );
    });

    test("requireSucceeded rejects a failed status", () => {
      const detail = makeDetail({ status: "failed" });
      expect(() =>
        assertLoopProofRun(detail, { requireSucceeded: true }),
      ).toThrow(AgentLoopJourneyProofError);
    });

    test("passes for a completed run with a started event", () => {
      const detail = makeDetail();
      expect(() => assertLoopProofRun(detail, {})).not.toThrow();
    });
  });

  describe("runJourney", () => {
    test("happy path: create -> activate -> dispatch -> poll -> assert -> delete", async () => {
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      let pollCount = 0;
      const fetchImpl = makeFetch((method, pathname) => {
        if (method === "POST" && pathname === "/api/agent-loops") {
          return jsonResponse(201, {
            loop: { id: "loop-j1", status: "draft" },
          });
        }
        if (method === "PATCH" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, {
            loop: { id: "loop-j1", status: "active" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/agent-loops/loop-j1/runs"
        ) {
          return jsonResponse(202, { runId: "run-1", created: true });
        }
        if (
          method === "GET" &&
          pathname === "/api/agent-loop-runs/run-1"
        ) {
          pollCount += 1;
          if (pollCount === 1) {
            return jsonResponse(200, {
              run: { id: "run-1", status: "running" },
              steps: [],
              events: [],
            });
          }
          return jsonResponse(200, {
            run: { id: "run-1", status: "completed" },
            steps: [],
            events: [{ eventName: "agent-loop.run.started" }],
          });
        }
        if (method === "DELETE" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(404, { error: "not found" });
        }
        throw new Error(`Unexpected request ${method} ${pathname}`);
      }, recorded);

      const logs: string[] = [];
      const summary = await runJourney(baseConfig(), {
        fetchImpl,
        log: (line) => logs.push(line),
      });

      expect(recorded.map((r) => `${r.method} ${r.url}`)).toEqual([
        "POST /api/agent-loops",
        "PATCH /api/agent-loops/loop-j1",
        "POST /api/agent-loops/loop-j1/runs",
        "GET /api/agent-loop-runs/run-1",
        "GET /api/agent-loop-runs/run-1",
        "DELETE /api/agent-loops/loop-j1",
        "GET /api/agent-loops/loop-j1",
      ]);
      for (const call of recorded) {
        expect(call.headers.get("Cookie")).toBe(
          "open_agents_test_user_id=dev-user",
        );
      }
      expect(summary).toMatchObject({
        journey: "passed",
        cleanup: "deleted",
        loopId: "loop-j1",
        runId: "run-1",
        runStatus: "completed",
      });
      expect(logs.some((line) => line.startsWith("journey-summary: "))).toBe(
        true,
      );
    });

    test("dispatch_failed 502 fails the journey but still cleans up", async () => {
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const fetchImpl = makeFetch((method, pathname) => {
        if (method === "POST" && pathname === "/api/agent-loops") {
          return jsonResponse(201, {
            loop: { id: "loop-j1", status: "draft" },
          });
        }
        if (method === "PATCH" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, {
            loop: { id: "loop-j1", status: "active" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/agent-loops/loop-j1/runs"
        ) {
          return jsonResponse(502, {
            success: false,
            errorKind: "dispatch_failed",
            message: "boom",
            runId: "run-1",
          });
        }
        if (method === "DELETE" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(404, { error: "not found" });
        }
        throw new Error(`Unexpected request ${method} ${pathname}`);
      }, recorded);

      const summary = await runJourney(baseConfig(), { fetchImpl, log: () => {} });
      expect(summary.journey).toBe("failed");
      expect(summary.failedStep).toBe("dispatch");
      expect(summary.cleanup).toBe("deleted");
    });

    test("hard deadline: never-terminal run fails the poll step", async () => {
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const fetchImpl = makeFetch((method, pathname) => {
        if (method === "POST" && pathname === "/api/agent-loops") {
          return jsonResponse(201, {
            loop: { id: "loop-j1", status: "draft" },
          });
        }
        if (method === "PATCH" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, {
            loop: { id: "loop-j1", status: "active" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/agent-loops/loop-j1/runs"
        ) {
          return jsonResponse(202, { runId: "run-1", created: true });
        }
        if (method === "GET" && pathname === "/api/agent-loop-runs/run-1") {
          return jsonResponse(200, {
            run: { id: "run-1", status: "running" },
            steps: [],
            events: [],
          });
        }
        if (method === "DELETE" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(404, { error: "not found" });
        }
        throw new Error(`Unexpected request ${method} ${pathname}`);
      }, recorded);

      const summary = await runJourney(
        baseConfig({ timeoutMs: 10, pollIntervalMs: 1 }),
        { fetchImpl, log: () => {} },
      );
      expect(summary.journey).toBe("failed");
      expect(summary.failedStep).toContain("poll");
      expect(summary.cleanup).toBe("deleted");
    });

    test("create rejected (400 loop_invalid) skips cleanup (no loopId)", async () => {
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const fetchImpl = makeFetch((method, pathname) => {
        if (method === "POST" && pathname === "/api/agent-loops") {
          return jsonResponse(400, {
            errorKind: "loop_invalid",
            errors: [],
          });
        }
        throw new Error(`Unexpected request ${method} ${pathname}`);
      }, recorded);

      const summary = await runJourney(baseConfig(), { fetchImpl, log: () => {} });
      expect(summary.journey).toBe("failed");
      expect(summary.failedStep).toBe("create");
      expect(summary.cleanup).toBe("skipped");
      expect(recorded.some((r) => r.method === "DELETE")).toBe(false);
    });

    test("confirm-draft guard fails when create returns active status", async () => {
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const fetchImpl = makeFetch((method, pathname) => {
        if (method === "POST" && pathname === "/api/agent-loops") {
          return jsonResponse(201, {
            loop: { id: "loop-j1", status: "active" },
          });
        }
        if (method === "DELETE" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(404, { error: "not found" });
        }
        throw new Error(`Unexpected request ${method} ${pathname}`);
      }, recorded);

      const summary = await runJourney(baseConfig(), { fetchImpl, log: () => {} });
      expect(summary.journey).toBe("failed");
      expect(summary.failedStep).toBe("confirm-draft");
      expect(summary.cleanup).toBe("deleted");
    });

    test("cleanup: DELETE 500 after a passing journey -> failed with warning, journey still passed", async () => {
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const fetchImpl = makeFetch((method, pathname) => {
        if (method === "POST" && pathname === "/api/agent-loops") {
          return jsonResponse(201, {
            loop: { id: "loop-j1", status: "draft" },
          });
        }
        if (method === "PATCH" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, {
            loop: { id: "loop-j1", status: "active" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/agent-loops/loop-j1/runs"
        ) {
          return jsonResponse(202, { runId: "run-1", created: true });
        }
        if (method === "GET" && pathname === "/api/agent-loop-runs/run-1") {
          return jsonResponse(200, {
            run: { id: "run-1", status: "completed" },
            steps: [],
            events: [{ eventName: "agent-loop.run.started" }],
          });
        }
        if (method === "DELETE" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(500, { error: "boom" });
        }
        throw new Error(`Unexpected request ${method} ${pathname}`);
      }, recorded);

      const logs: string[] = [];
      const summary = await runJourney(baseConfig(), {
        fetchImpl,
        log: (line) => logs.push(line),
      });
      expect(summary.journey).toBe("passed");
      expect(summary.cleanup).toBe("failed");
      expect(logs.some((line) => line.includes("WARNING"))).toBe(true);
    });

    test("cleanup: absence GET returns 200 after successful DELETE -> failed", async () => {
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const fetchImpl = makeFetch((method, pathname) => {
        if (method === "POST" && pathname === "/api/agent-loops") {
          return jsonResponse(201, {
            loop: { id: "loop-j1", status: "draft" },
          });
        }
        if (method === "PATCH" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, {
            loop: { id: "loop-j1", status: "active" },
          });
        }
        if (
          method === "POST" &&
          pathname === "/api/agent-loops/loop-j1/runs"
        ) {
          return jsonResponse(202, { runId: "run-1", created: true });
        }
        if (method === "GET" && pathname === "/api/agent-loop-runs/run-1") {
          return jsonResponse(200, {
            run: { id: "run-1", status: "completed" },
            steps: [],
            events: [{ eventName: "agent-loop.run.started" }],
          });
        }
        if (method === "DELETE" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, { success: true });
        }
        if (method === "GET" && pathname === "/api/agent-loops/loop-j1") {
          return jsonResponse(200, {
            loop: { id: "loop-j1", status: "active" },
          });
        }
        throw new Error(`Unexpected request ${method} ${pathname}`);
      }, recorded);

      const summary = await runJourney(baseConfig(), { fetchImpl, log: () => {} });
      expect(summary.journey).toBe("passed");
      expect(summary.cleanup).toBe("failed");
    });

    test("bypass secret headers are forwarded", async () => {
      const recorded: Array<{ method: string; url: string; headers: Headers }> =
        [];
      const fetchImpl = makeFetch((method, pathname) => {
        if (method === "POST" && pathname === "/api/agent-loops") {
          return jsonResponse(400, { errorKind: "loop_invalid", errors: [] });
        }
        throw new Error(`Unexpected request ${method} ${pathname}`);
      }, recorded);

      await runJourney(baseConfig({ bypassSecret: "shh" }), {
        fetchImpl,
        log: () => {},
      });
      expect(recorded[0]?.headers.get("x-vercel-protection-bypass")).toBe(
        "shh",
      );
    });
  });
});
