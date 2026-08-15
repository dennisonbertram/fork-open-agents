/**
 * Production verification for the MCP fan-out loop.
 *
 * Every check here exists because the thing it checks broke in production on
 * 2026-08-14/15 while unit tests, typecheck and CI were green. Unit tests
 * cannot reach these: they mock the transport, the sandbox and the workflow
 * step machinery, which is exactly where the failures lived.
 *
 * Run it against a deployed environment after a release:
 *
 *     MCP_TOKEN_FILE=~/.open-agents-mcp-token.json \
 *     bun run --cwd apps/web verify:mcp-loop
 *
 * The token file is the JSON returned by the MCP OAuth token endpoint. It must
 * contain `access_token`, `refresh_token` and `client_id`; the script renews
 * the access token itself, so an expired one is not a failure.
 *
 * Exit code is 0 only when every check passes.
 *
 * Design notes, all of them learned the hard way:
 *   - Transient network faults are retried. A watcher died twice on ECONNRESET
 *     during the original run and cost visibility at the worst moment.
 *   - Reads that depend on a run's recorded outcome poll with a bound rather
 *     than reading once. `activity` flips to idle before the outcome row
 *     lands, so a single read reports a null that is not a failure (#1259).
 *   - Nothing here asserts on wall-clock timing, ordering between independent
 *     sessions, or counts that other traffic can change.
 */

type TokenFile = {
  access_token: string;
  refresh_token: string;
  client_id: string;
};

/**
 * Exported to make this file a module. Without an export, TypeScript treats a
 * script with no imports as global scope, so its top-level names collide with
 * the other files in scripts/ and top-level `await` is rejected.
 */
export type Check = { name: string; pass: boolean; detail: string };

const BASE =
  process.env.MCP_BASE_URL ??
  "https://open-agents-dennisons-projects.vercel.app";
const TOKEN_FILE =
  process.env.MCP_TOKEN_FILE ??
  `${process.env.HOME}/.open-agents-mcp-token.json`;
const REPO_OWNER = process.env.MCP_VERIFY_REPO_OWNER ?? "dennisonbertram";
const REPO_NAME = process.env.MCP_VERIFY_REPO_NAME ?? "fork-open-agents";
const BASE_BRANCH = process.env.MCP_VERIFY_BASE_BRANCH ?? "develop";

const checks: Check[] = [];
let token: TokenFile;
let mcpSessionId: string | null = null;
let requestId = 0;

function record(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|socket connection|fetch failed|terminated|ETIMEDOUT/i.test(
    message,
  );
}

async function renewAccessToken(): Promise<boolean> {
  const response = await fetch(`${BASE}/api/auth/mcp/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: token.client_id,
    }),
  });
  if (!response.ok) {
    return false;
  }
  const next = (await response.json()) as Partial<TokenFile>;
  token = { ...token, ...next };
  await Bun.write(TOKEN_FILE, JSON.stringify(token, null, 2));
  return true;
}

async function rpcOnce(
  method: string,
  params?: unknown,
  notify = false,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token.access_token}`,
  };
  if (mcpSessionId) {
    headers["mcp-session-id"] = mcpSessionId;
  }
  const body: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params !== undefined) {
    body.params = params;
  }
  if (!notify) {
    requestId += 1;
    body.id = requestId;
  }

  const response = await fetch(`${BASE}/api/mcp/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const returnedSession = response.headers.get("mcp-session-id");
  if (returnedSession) {
    mcpSessionId = returnedSession;
  }
  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }
  const text = await response.text();
  if (notify) {
    return null;
  }
  const contentType = response.headers.get("content-type") ?? "";
  const parsed = contentType.includes("text/event-stream")
    ? JSON.parse(
        text
          .split("\n")
          .findLast((line) => line.startsWith("data:"))
          ?.slice(5)
          .trim() ?? "{}",
      )
    : JSON.parse(text);
  if (parsed.error) {
    throw new Error(JSON.stringify(parsed.error));
  }
  return parsed.result;
}

async function handshake(): Promise<void> {
  await rpcOnce("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "verify-mcp-loop", version: "1.0.0" },
  });
  await rpcOnce("notifications/initialized", undefined, true);
}

/** Retries transient faults and one token expiry. Never retries a tool error. */
async function rpc(method: string, params?: unknown): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await rpcOnce(method, params);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNAUTHORIZED")) {
        mcpSessionId = null;
        if (await renewAccessToken()) {
          await handshake();
          continue;
        }
      }
      if (isTransient(error)) {
        await Bun.sleep(3000 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { text?: string }[];
};

async function callTool(
  name: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  const result = (await rpc("tools/call", {
    name,
    arguments: args,
  })) as ToolResult;
  if (result.isError) {
    throw new Error(
      `${name}: ${result.content?.map((part) => part.text).join("\n")}`,
    );
  }
  return result.structuredContent ?? {};
}

/**
 * Waits for a session's run to finish AND for its outcome to be recorded.
 *
 * Both conditions matter. `activity` reports idle before the outcome row is
 * written, so polling on idle alone reads a null outcome that is a timing
 * artefact rather than a result (#1259).
 */
async function waitForRecordedOutcome(
  sessionId: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let latest: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    latest = await callTool("open_agents_get_session", { sessionId });
    if (latest.activity === "idle" && latest.lastRunOutcome !== null) {
      return latest;
    }
    await Bun.sleep(10_000);
  }
  return latest;
}

async function main(): Promise<void> {
  token = (await Bun.file(TOKEN_FILE).json()) as TokenFile;
  await handshake();

  // 1. Every tool the loop depends on is registered and reachable.
  const listed = (await rpc("tools/list")) as { tools: { name: string }[] };
  const toolNames = listed.tools.map((tool) => tool.name);
  const required = [
    "open_agents_whoami",
    "open_agents_list_sessions",
    "open_agents_get_session",
    "open_agents_get_messages",
    "open_agents_start_session",
    "open_agents_send_message",
    "open_agents_stop_run",
    "open_agents_archive_session",
  ];
  const missing = required.filter((name) => !toolNames.includes(name));
  record(
    "required tools are registered",
    missing.length === 0,
    missing.length === 0
      ? `${toolNames.length} tools registered`
      : `missing: ${missing.join(", ")}`,
  );

  // 2. Paging is stable: a full walk collects every row exactly once.
  //    An unstable sort silently skips rows rather than erroring (#1184).
  const pageSize = 7;
  const seen = new Set<string>();
  let offset = 0;
  let total = -1;
  let duplicates = 0;
  for (let page = 0; page < 60; page += 1) {
    const result = (await callTool("open_agents_list_sessions", {
      status: "all",
      sort: "created_desc",
      limit: pageSize,
      offset,
    })) as {
      sessions: { id: string }[];
      returned: number;
      total: number;
    };
    total = result.total;
    for (const session of result.sessions) {
      if (seen.has(session.id)) {
        duplicates += 1;
      }
      seen.add(session.id);
    }
    offset += result.returned;
    if (result.returned === 0 || offset >= result.total) {
      break;
    }
  }
  record(
    "a full paged walk collects every session once",
    seen.size === total && duplicates === 0,
    `collected ${seen.size} of ${total}, ${duplicates} duplicates`,
  );

  // 3. A headless slice runs a policy-gated command to completion.
  //    Before #1272 this stalled forever on an approval nobody could answer,
  //    and the stall then wedged the session (#1275).
  const label = `verify-mcp-loop-${Date.now()}`;
  const started = await callTool("open_agents_start_session", {
    repoOwner: REPO_OWNER,
    repoName: REPO_NAME,
    branch: BASE_BRANCH,
    label,
    autoCommit: false,
    autoCreatePr: false,
    prompt: [
      "This is a platform test. Do NOT modify any tracked file in the repository.",
      "",
      "Run exactly these commands with the bash tool, in order:",
      "  1. mkdir -p /tmp/verifyloop && echo ok > /tmp/verifyloop/a.txt && cat /tmp/verifyloop/a.txt",
      "  2. rm -rf /tmp/verifyloop",
      "",
      "Command 2 is gated by the tool-approval policy. A headless run must not be asked to approve it.",
      "",
      "Then reply with exactly this one line and nothing else:",
      "  VERIFY_OK <exit status of command 1> <exit status of command 2>",
      "",
      "If anything asks for approval, stop and reply with a line beginning BLOCKED:.",
    ].join("\n"),
  });
  const sessionId = started.sessionId as string;

  const finished = await waitForRecordedOutcome(sessionId, 10 * 60 * 1000);
  const transcript = (await callTool("open_agents_get_messages", {
    sessionId,
    limit: 4,
    includeToolTrace: true,
  })) as {
    messages: {
      role: string;
      text: string;
      toolTrace?: { name: string; state: string; input: string }[];
    }[];
  };
  const assistant = transcript.messages.findLast(
    (message) => message.role === "assistant",
  );
  const trace = assistant?.toolTrace ?? [];
  const gatedRan = trace.some(
    (entry) => /rm -rf/.test(entry.input) && entry.state === "output-available",
  );
  const stalled = trace.filter(
    (entry) =>
      entry.state === "approval-requested" || entry.state === "input-available",
  );
  record(
    "a headless slice runs a gated command unattended",
    finished.lastRunOutcome === "completed" &&
      gatedRan &&
      stalled.length === 0 &&
      /VERIFY_OK/.test(assistant?.text ?? ""),
    `outcome=${finished.lastRunOutcome} gatedRan=${gatedRan} stalled=${stalled.length} answer=${JSON.stringify((assistant?.text ?? "").trim().slice(0, 80))}`,
  );

  // 4. The transcript is readable in full, with the tool trace.
  //    It was capped at 280 characters with tool calls dropped entirely.
  const longest = transcript.messages
    .filter((message) => message.role === "assistant")
    .reduce<{ text: string; chars: number } | undefined>(
      (best, message) =>
        ((message as { chars?: number }).chars ?? (best?.chars ?? 0) < 0)
          ? (message as unknown as { text: string; chars: number })
          : best,
      undefined,
    );
  record(
    "transcripts return full text and a tool trace",
    Boolean(longest) &&
      longest?.text.length === longest?.chars &&
      trace.length > 0,
    `chars=${longest?.chars} textLength=${longest?.text.length} toolCalls=${trace.length}`,
  );

  // 5. The batch is findable by label, the path a second device would use.
  const byLabel = (await callTool("open_agents_list_sessions", {
    status: "all",
    label,
    limit: 10,
  })) as { sessions: { id: string }[]; total: number };
  record(
    "a batch is findable by label alone",
    byLabel.sessions.some((session) => session.id === sessionId),
    `label=${label} total=${byLabel.total}`,
  );

  // 6. get_updates answers "what finished while I was away" (#1270).
  if (toolNames.includes("open_agents_get_updates")) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const updates = (await callTool("open_agents_get_updates", {
      since,
      limit: 25,
    })) as {
      cursor: string;
      count: number;
      changes: { sessionId?: string }[];
      note: string | null;
    };
    record(
      "get_updates reports the run that just finished",
      updates.count > 0 &&
        updates.changes.some((change) => change.sessionId === sessionId),
      `count=${updates.count} cursor=${updates.cursor}`,
    );

    const future = (await callTool("open_agents_get_updates", {
      since: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })) as { count: number; note: string | null };
    record(
      "get_updates says 'nothing changed' explicitly",
      future.count === 0 &&
        typeof future.note === "string" &&
        future.note.length > 0,
      `count=${future.count} note=${JSON.stringify(future.note)}`,
    );
  } else {
    record(
      "get_updates is available",
      false,
      "tool not registered in this environment",
    );
  }

  // 7. Archive is idempotent and cleans up after this run.
  const archived = await callTool("open_agents_archive_session", { sessionId });
  const archivedAgain = await callTool("open_agents_archive_session", {
    sessionId,
  });
  record(
    "archive works and is idempotent",
    archived.alreadyArchived === false &&
      archivedAgain.alreadyArchived === true,
    `first=${archived.alreadyArchived} second=${archivedAgain.alreadyArchived}`,
  );

  const failed = checks.filter((check) => !check.pass);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed`,
  );
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.map((check) => check.name).join("; ")}`);
    process.exit(1);
  }
}

await main();
