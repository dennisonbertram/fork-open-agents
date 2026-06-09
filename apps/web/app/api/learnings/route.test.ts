import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// ---- Auth mock ----
type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

let authResult: AuthResult = { ok: true, userId: "user-1" };

mock.module("@/app/api/sessions/_lib/session-context", () => ({
  requireAuthenticatedUser: async () => authResult,
}));

// ---- Learnings agent mock ----
type EnsureResult = {
  agentId?: string;
  errorKind?: string;
  idempotent?: boolean;
};

type DisableResult = {
  agentId?: string;
  errorKind?: string;
};

let ensureResult: EnsureResult = { agentId: "agent-42" };
let disableResult: DisableResult = { agentId: "agent-42" };
let isAgentEnabled = false;

const ensureRepoLearningsAgent = mock(async () => ensureResult);
const disableRepoLearningsAgent = mock(async () => disableResult);
const getRepoLearningsAgentStatus = mock(async () => ({
  enabled: isAgentEnabled,
  agentId: isAgentEnabled ? "agent-42" : undefined,
}));

mock.module("@/lib/learnings/builtin-agent", () => ({
  ensureRepoLearningsAgent,
  disableRepoLearningsAgent,
  getRepoLearningsAgentStatus,
}));

// ---- Webhook readiness mock ----
let webhookCheck: {
  status: "ready" | "missing";
  missing: string[];
  id: string;
  label: string;
  detail: string;
} = {
  id: "github_app_webhooks",
  label: "GitHub App webhooks",
  status: "ready",
  missing: [],
  detail: "All event subscriptions present.",
};

mock.module("@/lib/background-agents/github-app-webhooks", () => ({
  getGitHubAppWebhookReadinessCheck: async () => webhookCheck,
}));

const routeModulePromise = import("./route");

describe("POST /api/learnings", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    ensureResult = { agentId: "agent-42" };
    disableResult = { agentId: "agent-42" };
    isAgentEnabled = false;
    webhookCheck = {
      id: "github_app_webhooks",
      label: "GitHub App webhooks",
      status: "ready",
      missing: [],
      detail: "All event subscriptions present.",
    };
    ensureRepoLearningsAgent.mockClear();
    disableRepoLearningsAgent.mockClear();
    getRepoLearningsAgentStatus.mockClear();
    ensureRepoLearningsAgent.mockImplementation(async () => ensureResult);
    disableRepoLearningsAgent.mockImplementation(async () => disableResult);
    getRepoLearningsAgentStatus.mockImplementation(async () => ({
      enabled: isAgentEnabled,
      agentId: isAgentEnabled ? "agent-42" : undefined,
    }));
  });

  test("returns 401 when not authenticated", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/learnings", {
        method: "POST",
        body: JSON.stringify({ repoOwner: "acme", repoName: "widgets", enabled: true }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
    expect(ensureRepoLearningsAgent).not.toHaveBeenCalled();
  });

  test("returns 400 on invalid body", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/learnings", {
        method: "POST",
        body: JSON.stringify({ repoOwner: "acme" }), // missing repoName and enabled
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
  });

  test("returns 403 with error verdict when user lacks write access", async () => {
    ensureResult = { errorKind: "user_no_write" };
    ensureRepoLearningsAgent.mockImplementation(async () => ensureResult);
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/learnings", {
        method: "POST",
        body: JSON.stringify({ repoOwner: "acme", repoName: "widgets", enabled: true }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.verdict).toBeDefined();
    expect(body.verdict.status).toBe("error");
    expect(body.verdict.errorKind).toBe("user_no_write");
  });

  test("returns 404 with unavailable verdict when no GitHub App installation", async () => {
    ensureResult = { errorKind: "no_installation" };
    ensureRepoLearningsAgent.mockImplementation(async () => ensureResult);
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/learnings", {
        method: "POST",
        body: JSON.stringify({ repoOwner: "acme", repoName: "widgets", enabled: true }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.verdict).toBeDefined();
    expect(body.verdict.status).toBe("unavailable");
    expect(body.verdict.errorKind).toBe("no_installation");
  });

  test("enable happy path returns 200 with enabled:true, agentId, and ready verdict", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/learnings", {
        method: "POST",
        body: JSON.stringify({ repoOwner: "acme", repoName: "widgets", enabled: true }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.agentId).toBe("agent-42");
    expect(body.verdict).toBeDefined();
    expect(body.verdict.status).toBe("ready");
    expect(body.verdict.headline).toMatch(/enabled/i);
  });

  test("disable path returns 200 with enabled:false", async () => {
    isAgentEnabled = true;
    getRepoLearningsAgentStatus.mockImplementation(async () => ({
      enabled: true,
      agentId: "agent-42",
    }));
    const { POST } = await routeModulePromise;

    const response = await POST(
      new Request("http://localhost/api/learnings", {
        method: "POST",
        body: JSON.stringify({ repoOwner: "acme", repoName: "widgets", enabled: false }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(disableRepoLearningsAgent).toHaveBeenCalledWith(
      "user-1",
      "acme",
      "widgets",
    );
  });
});

describe("GET /api/learnings", () => {
  beforeEach(() => {
    authResult = { ok: true, userId: "user-1" };
    isAgentEnabled = false;
    webhookCheck = {
      id: "github_app_webhooks",
      label: "GitHub App webhooks",
      status: "ready",
      missing: [],
      detail: "All event subscriptions present.",
    };
    ensureRepoLearningsAgent.mockClear();
    disableRepoLearningsAgent.mockClear();
    getRepoLearningsAgentStatus.mockClear();
    getRepoLearningsAgentStatus.mockImplementation(async () => ({
      enabled: isAgentEnabled,
      agentId: isAgentEnabled ? "agent-42" : undefined,
    }));
  });

  test("returns 401 when not authenticated", async () => {
    authResult = {
      ok: false,
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/learnings?repoOwner=acme&repoName=widgets",
      ),
    );

    expect(response.status).toBe(401);
  });

  test("returns enabled state and ready verdict when subscription present", async () => {
    isAgentEnabled = true;
    getRepoLearningsAgentStatus.mockImplementation(async () => ({
      enabled: true,
      agentId: "agent-42",
    }));
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/learnings?repoOwner=acme&repoName=widgets",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.verdict).toBeDefined();
    expect(body.verdict.status).toBe("ready");
  });

  test("surfaces missing pull_request_review subscription as action-needed verdict", async () => {
    webhookCheck = {
      id: "github_app_webhooks",
      label: "GitHub App webhooks",
      status: "missing",
      missing: ["event:pull_request_review"],
      detail: "GitHub App must subscribe to pull_request_review.",
    };
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/learnings?repoOwner=acme&repoName=widgets",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.verdict.status).toBe("action-needed");
    expect(body.missingEvents).toContain("pull_request_review");
  });

  test("returns action-needed verdict when agent is not yet enabled", async () => {
    isAgentEnabled = false;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/learnings?repoOwner=acme&repoName=widgets",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.verdict.status).toBe("action-needed");
  });
});
