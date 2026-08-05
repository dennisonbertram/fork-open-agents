/**
 * Journeys for the API route paths that `journeys-core.ts` never touches.
 *
 * Same contract as the core file: real ids carried between calls, expectations
 * recording what the API *actually* answers today (with a comment wherever the
 * observed status looks wrong), and `assert` hooks wherever a bare 200 would
 * not prove the server did anything.
 */
import {
  formatJourneyMarkdown,
  type Journey,
  runJourney,
} from "./journey-runner";

/**
 * Repo used for the GitHub-backed journeys. The local test identity
 * (`dev-managed-runtime-user`) has no stored GitHub user token and no GitHub
 * App installation, so these calls cannot reach GitHub. They are exercised
 * anyway — deliberately not skipped — so the harness records the failure the
 * API actually produces for an unconnected identity.
 */
// Deliberately a repository that does not exist. The point of these steps is
// the API's access-denial contract, which does not depend on the repo being
// real — and pointing them at the actual fork would mean that the moment the
// dev database gains working GitHub credentials, the POST/PUT/DELETE probes
// below would create, overwrite and delete real repository secrets and
// dispatch real workflow runs. The probe must not be one credential away from
// mutating a live repo.
const GH_OWNER = "open-agents-contract-probe";
const GH_REPO = "repo-that-does-not-exist";
// The /api/github/repos/* routes previously answered a bare 500 with an empty
// body for an identity with no usable GitHub credential. PR #1070 fixed that:
// they now return 403 { ok, errorKind: "repo_access_denied", error }. These
// steps were retargeted from 500 to 403 when that landed, which is the harness
// working as intended — it went red the moment the defect was fixed.
//
// Remaining nit worth noting: `error` carries the kind string rather than a
// human-readable message, so it does not yet match the envelope in #1054.
const GH_REPO_PATH = `/api/github/repos/${GH_OWNER}/${GH_REPO}`;

// The learnings routes are account-scoped and safe to exercise against a real
// repo slug — they only read and toggle a row in this app's own database.
const LEARNINGS_OWNER = "dennisonbertram";
const LEARNINGS_REPO = "fork-open-agents";

export const extendedJourneys: Journey[] = [
  {
    id: "J-X-AUTOMATIONS-01",
    title: "Unified automations and runs listings",
    steps: [
      {
        name: "anonymous caller cannot list automations",
        method: "GET",
        path: "/api/automations",
        anonymous: true,
        expect: [401],
      },
      {
        name: "list automations",
        method: "GET",
        path: "/api/automations",
        assert: (body) => {
          const payload = body as {
            requestId?: unknown;
            automations?: unknown;
          };
          if (typeof payload.requestId !== "string") {
            return "response is missing the requestId correlation field";
          }
          return Array.isArray(payload.automations)
            ? null
            : "response is missing the automations array";
        },
      },
      {
        // parseAutomationFilters only validates `repository`, `kind` and
        // `state`; every other query parameter is silently ignored, so an
        // unknown filter name cannot be probed here.
        name: "reject an unknown automation kind filter",
        method: "GET",
        path: "/api/automations?kind=not-a-real-kind",
        expect: [400],
        assert: (body) => {
          const payload = body as { errorKind?: string };
          return payload.errorKind === "invalid_filters"
            ? null
            : `expected errorKind "invalid_filters", got ${JSON.stringify(payload.errorKind)}`;
        },
      },
      {
        name: "reject a malformed repository filter",
        method: "GET",
        path: "/api/automations?repository=owner-with-no-slash",
        expect: [400],
      },
      {
        name: "anonymous caller cannot list runs",
        method: "GET",
        path: "/api/runs",
        anonymous: true,
        expect: [401],
      },
      {
        name: "list runs",
        method: "GET",
        path: "/api/runs",
        assert: (body) => {
          const payload = body as { requestId?: unknown; items?: unknown };
          if (typeof payload.requestId !== "string") {
            return "response is missing the requestId correlation field";
          }
          return Array.isArray(payload.items)
            ? null
            : "response is missing the items array";
        },
      },
      {
        name: "reject a non-numeric runs limit",
        method: "GET",
        path: "/api/runs?limit=abc",
        expect: [400],
        assert: (body) => {
          const code = (body as { error?: { code?: string } }).error?.code;
          return code === "invalid_query"
            ? null
            : `expected error.code "invalid_query", got ${JSON.stringify(code)}`;
        },
      },
    ],
  },
  {
    id: "J-X-LEARNINGS-01",
    title: "Repo learnings feed, toggle and per-learning mutations",
    steps: [
      {
        name: "anonymous caller cannot read the learnings feed",
        method: "GET",
        path: "/api/learnings",
        anonymous: true,
        expect: [401],
      },
      {
        // No repoOwner/repoName: the route answers 200 with an empty feed
        // rather than 400, because the readiness verdict is repo-independent.
        name: "learnings feed without a repo returns an empty feed",
        method: "GET",
        path: "/api/learnings",
        assert: (body) => {
          const payload = body as {
            enabled?: unknown;
            verdict?: { status?: string };
            learnings?: unknown;
          };
          if (typeof payload.enabled !== "boolean") {
            return "response is missing the enabled flag";
          }
          if (!payload.verdict?.status) {
            return "response is missing the readiness verdict";
          }
          return Array.isArray(payload.learnings)
            ? null
            : "response is missing the learnings array";
        },
      },
      {
        name: "learnings feed for a specific repo",
        method: "GET",
        path: `/api/learnings?repoOwner=${LEARNINGS_OWNER}&repoName=${LEARNINGS_REPO}`,
        assert: (body) =>
          Array.isArray((body as { learnings?: unknown }).learnings)
            ? null
            : "response is missing the learnings array",
      },
      {
        name: "reject a toggle with no repoName or enabled flag",
        method: "POST",
        path: "/api/learnings",
        body: { repoOwner: GH_OWNER },
        expect: [400],
      },
      {
        // Disabling does not need GitHub access, so this is the only side of
        // the toggle the local identity can exercise. Enabling would need a
        // GitHub App installation (see J-X-GITHUB-01).
        name: "disable the learnings agent for a repo",
        method: "POST",
        path: "/api/learnings",
        body: {
          repoOwner: LEARNINGS_OWNER,
          repoName: LEARNINGS_REPO,
          enabled: false,
        },
        assert: (body) => {
          const payload = body as {
            enabled?: unknown;
            verdict?: { status?: string };
          };
          if (payload.enabled !== false) {
            return `expected enabled=false, got ${JSON.stringify(payload.enabled)}`;
          }
          return payload.verdict?.status === "action-needed"
            ? null
            : `expected verdict.status "action-needed", got ${JSON.stringify(payload.verdict?.status)}`;
        },
      },
      {
        name: "the disabled state is reflected in the feed",
        method: "GET",
        path: `/api/learnings?repoOwner=${LEARNINGS_OWNER}&repoName=${LEARNINGS_REPO}`,
        assert: (body) =>
          (body as { enabled?: unknown }).enabled === false
            ? null
            : "the feed did not report the agent as disabled after the toggle",
      },
      {
        name: "unknown learning id is a 404",
        method: "GET",
        path: "/api/learnings/definitely-not-a-real-learning",
        expect: [404],
        assert: (body) => {
          const kind = (body as { errorKind?: string }).errorKind;
          return kind === "learning_not_found"
            ? null
            : `expected errorKind "learning_not_found", got ${JSON.stringify(kind)}`;
        },
      },
      {
        // Raised in review: the disable above is a persistent write, so the
        // journey should put the state back. It cannot — and that asymmetry is
        // the finding. Disabling needs no GitHub access; re-enabling requires a
        // GitHub App installation, so an identity that can turn learnings OFF
        // cannot necessarily turn them back ON. A user who disables by mistake
        // is stuck until they connect the App.
        //
        // The step is kept, pinned to the real outcome, so it goes red if the
        // route ever becomes symmetric.
        name: "re-enabling is refused without a GitHub App installation (asymmetric toggle)",
        method: "POST",
        path: "/api/learnings",
        body: {
          repoOwner: LEARNINGS_OWNER,
          repoName: LEARNINGS_REPO,
          enabled: true,
        },
        expect: [404],
        assert: (body) => {
          const kind = (body as { verdict?: { errorKind?: string } }).verdict
            ?.errorKind;
          return kind === "no_installation"
            ? null
            : `expected verdict.errorKind "no_installation", got ${JSON.stringify(kind)}`;
        },
      },
      {
        // Ownership is checked before the body is parsed, so an unknown id
        // shadows validation errors: this invalid body still yields 404.
        name: "PATCH on an unknown learning is a 404, not a validation error",
        method: "PATCH",
        path: "/api/learnings/definitely-not-a-real-learning",
        body: { status: "not-a-real-status" },
        expect: [404],
        assert: (body) =>
          (body as { errorKind?: string }).errorKind === "learning_not_found"
            ? null
            : "expected the not-found errorKind to take precedence over validation",
      },
      {
        name: "DELETE (archive) on an unknown learning is a 404",
        method: "DELETE",
        path: "/api/learnings/definitely-not-a-real-learning",
        expect: [404],
      },
    ],
  },
  {
    id: "J-X-GITHUB-01",
    title: "GitHub repo secrets and Actions routes without a GitHub credential",
    steps: [
      {
        name: "anonymous caller cannot list repo secrets",
        method: "GET",
        path: `${GH_REPO_PATH}/secrets`,
        anonymous: true,
        expect: [401],
      },
      {
        // OBSERVED DEFECT: every /api/github/repos/* route below answers 500
        // with an empty body for the local test identity, which has no stored
        // GitHub user token. The route helpers
        // (apps/web/app/api/github/repos/[owner]/[repo]/secrets/_lib.ts and
        // .../actions/_lib.ts) are written to return a typed JSON body
        // ({ ok: false, errorKind: "github_not_connected" }) for exactly this
        // case, so the typed failure the harness should be asserting never
        // reaches the client. Cause not verified: an exception is escaping
        // before the typed branch runs (getUserOctokit -> getUserGitHubToken is
        // the most likely thrower when token-decryption env is absent), but the
        // 500 body is empty and this run had no access to the server log.
        // Expectations below record the 500 as observed, not as intended.
        name: "list repo secrets is denied with a typed 403 for an unconnected identity",
        method: "GET",
        path: `${GH_REPO_PATH}/secrets`,
        expect: [403],
      },
      {
        name: "create a repo secret is denied with a typed 403",
        method: "POST",
        path: `${GH_REPO_PATH}/secrets`,
        body: { name: "OPEN_AGENTS_CONTRACT_PROBE", value: "not-a-real-value" },
        expect: [403],
      },
      {
        name: "update a repo secret is denied with a typed 403",
        method: "PUT",
        path: `${GH_REPO_PATH}/secrets/OPEN_AGENTS_CONTRACT_PROBE`,
        body: { value: "not-a-real-value" },
        expect: [403],
      },
      {
        name: "delete a repo secret is denied with a typed 403",
        method: "DELETE",
        path: `${GH_REPO_PATH}/secrets/OPEN_AGENTS_CONTRACT_PROBE`,
        expect: [403],
      },
      {
        name: "anonymous caller cannot list Actions workflows",
        method: "GET",
        path: `${GH_REPO_PATH}/actions/workflows`,
        anonymous: true,
        expect: [401],
      },
      {
        name: "list Actions workflows is denied with a typed 403",
        method: "GET",
        path: `${GH_REPO_PATH}/actions/workflows`,
        expect: [403],
      },
      {
        name: "dispatch a workflow is denied with a typed 403",
        method: "POST",
        path: `${GH_REPO_PATH}/actions/workflows/ci.yml/dispatch`,
        body: { ref: "develop" },
        expect: [403],
      },
      {
        // The invalid-job-id guard lives *after* the access check, so even a
        // non-numeric job id cannot reach its 400 branch here.
        name: "job logs with a non-numeric id is denied with a typed 403",
        method: "GET",
        path: `${GH_REPO_PATH}/actions/jobs/not-a-number/logs`,
        expect: [403],
      },
      {
        name: "job logs for a numeric id is denied with a typed 403",
        method: "GET",
        path: `${GH_REPO_PATH}/actions/jobs/123456789/logs`,
        expect: [403],
      },
    ],
  },
  {
    id: "J-X-SESSION-DIAG-01",
    title: "Session browser runs and chat debug bundle",
    steps: [
      {
        name: "create a session",
        method: "POST",
        path: "/api/sessions",
        body: { title: "API extended probe session" },
        expect: [200, 201],
        capture: (body, ctx) => {
          ctx.sessionId = (body as { session?: { id?: string } }).session?.id;
        },
      },
      {
        name: "create a chat in the session",
        method: "POST",
        path: (ctx) => `/api/sessions/${ctx.sessionId}/chats`,
        body: {},
        skipIf: (ctx) => !ctx.sessionId,
        capture: (body, ctx) => {
          ctx.chatId = (body as { chat?: { id?: string } }).chat?.id;
        },
      },
      {
        // A classic-runtime session short-circuits to an empty list without
        // touching the browser-run store.
        name: "browser runs list is empty for a classic-runtime session",
        method: "GET",
        path: (ctx) => `/api/sessions/${ctx.sessionId}/browser-runs`,
        skipIf: (ctx) => !ctx.sessionId,
        assert: (body) => {
          const runs = (body as { runs?: unknown }).runs;
          if (!Array.isArray(runs)) return "response is missing the runs array";
          return runs.length === 0
            ? null
            : `expected no runs for a session with no sandbox, got ${runs.length}`;
        },
      },
      {
        name: "starting a browser run without a sandbox is a 409",
        method: "POST",
        path: (ctx) => `/api/sessions/${ctx.sessionId}/browser-runs`,
        body: { targetUrl: "http://localhost:3000" },
        skipIf: (ctx) => !ctx.sessionId,
        expect: [409],
      },
      {
        name: "browser runs for an unknown session is a 404",
        method: "GET",
        path: "/api/sessions/definitely-not-a-real-session-id/browser-runs",
        expect: [404],
      },
      {
        name: "read the chat debug bundle as JSON",
        method: "GET",
        path: (ctx) =>
          `/api/sessions/${ctx.sessionId}/chats/${ctx.chatId}/debug-bundle`,
        skipIf: (ctx) => !(ctx.sessionId && ctx.chatId),
        assert: (body, ctx) => {
          const payload = body as {
            bundle?: { kind?: string };
            session?: { id?: string };
          };
          if (payload.bundle?.kind !== "chat_debug_bundle") {
            return `expected bundle.kind "chat_debug_bundle", got ${JSON.stringify(payload.bundle?.kind)}`;
          }
          return payload.session?.id === ctx.sessionId
            ? null
            : "the bundle did not carry the session it was requested for";
        },
      },
      {
        name: "read the same bundle as markdown",
        method: "GET",
        path: (ctx) =>
          `/api/sessions/${ctx.sessionId}/chats/${ctx.chatId}/debug-bundle?format=markdown`,
        skipIf: (ctx) => !(ctx.sessionId && ctx.chatId),
        assert: (body) =>
          typeof body === "string" && body.startsWith("# Chat Debug Bundle")
            ? null
            : "markdown rendering did not return a chat debug bundle document",
      },
      {
        name: "mint a signed diagnostic bundle URL",
        method: "POST",
        path: (ctx) =>
          `/api/sessions/${ctx.sessionId}/chats/${ctx.chatId}/debug-bundle`,
        body: { ttlMinutes: 5 },
        skipIf: (ctx) => !(ctx.sessionId && ctx.chatId),
        capture: (body, ctx) => {
          ctx.bundleToken = (body as { token?: string }).token;
        },
        assert: (body) => {
          const payload = body as {
            url?: string;
            token?: string;
            expiresAt?: string;
            redaction?: { status?: string };
          };
          if (!(payload.token && payload.url?.includes("token="))) {
            return "response did not return a signed bundle URL and token";
          }
          return payload.redaction?.status === "passed"
            ? null
            : "response did not report a passing redaction status";
        },
      },
      {
        name: "the signed token grants anonymous read access to the bundle",
        method: "GET",
        path: (ctx) =>
          `/api/sessions/${ctx.sessionId}/chats/${ctx.chatId}/debug-bundle?token=${encodeURIComponent(String(ctx.bundleToken))}`,
        anonymous: true,
        skipIf: (ctx) => !ctx.bundleToken,
        assert: (body) =>
          (body as { bundle?: { kind?: string } }).bundle?.kind ===
          "chat_debug_bundle"
            ? null
            : "the signed URL did not return a chat debug bundle",
      },
      {
        name: "a forged diagnostic token is a 401",
        method: "GET",
        path: (ctx) =>
          `/api/sessions/${ctx.sessionId}/chats/${ctx.chatId}/debug-bundle?token=not-a-real-token`,
        anonymous: true,
        skipIf: (ctx) => !(ctx.sessionId && ctx.chatId),
        expect: [401],
      },
      {
        name: "an unknown chat id is a 404",
        method: "GET",
        path: (ctx) =>
          `/api/sessions/${ctx.sessionId}/chats/definitely-not-a-real-chat/debug-bundle`,
        skipIf: (ctx) => !ctx.sessionId,
        expect: [404],
      },
      {
        name: "clean up the session",
        method: "DELETE",
        path: (ctx) => `/api/sessions/${ctx.sessionId}`,
        skipIf: (ctx) => !ctx.sessionId,
      },
    ],
  },
  {
    id: "J-X-MISC-01",
    title: "Transcription, usage rank, Vercel repo projects, workflow catalog",
    steps: [
      {
        name: "anonymous caller cannot transcribe",
        method: "POST",
        path: "/api/transcribe",
        body: { audio: "AAAA" },
        anonymous: true,
        expect: [401],
      },
      {
        name: "transcribe rejects a body with no audio",
        method: "POST",
        path: "/api/transcribe",
        body: {},
        expect: [400],
        assert: (body) =>
          typeof (body as { error?: string }).error === "string"
            ? null
            : "expected a typed error message",
      },
      {
        // OBSERVED DEFECT: audio the provider cannot decode is a client error,
        // but the route collapses every provider failure into a 500 with the
        // opaque message "Transcription failed". A malformed-audio 400 (or at
        // least a distinguishable errorKind) would be the right contract.
        // 429 is accepted alongside 500 because /api/transcribe is rate
        // limited (10/min). Running this suite repeatedly — which is the point
        // of a gate — legitimately trips that limit, and a rate-limited
        // response is a correct outcome, not a contract change. Found by
        // running the gate on a loop: it passed twice and failed on the third
        // run, which is exactly the kind of hidden non-idempotency a
        // single-shot test never surfaces.
        name: "undecodable audio is reported as a 500 (should be a 4xx), or 429 once rate limited",
        method: "POST",
        path: "/api/transcribe",
        body: { audio: "AAAA" },
        expect: [500, 429],
        timeoutMs: 30_000,
      },
      {
        name: "anonymous caller cannot read their usage rank",
        method: "GET",
        path: "/api/usage/rank",
        anonymous: true,
        expect: [401],
      },
      {
        // A user with no eligible email domain / no usage today gets a bare
        // `null` JSON body with a 200, not an object and not a 404.
        name: "usage rank returns null when the user has no ranked domain",
        method: "GET",
        path: "/api/usage/rank",
        assert: (body) => {
          if (body === null) return null;
          const payload = body as { rank?: unknown; total?: unknown };
          return typeof payload.rank === "number" &&
            typeof payload.total === "number"
            ? null
            : `expected null or a {rank,total,domain} object, got ${JSON.stringify(body).slice(0, 120)}`;
        },
      },
      {
        name: "anonymous caller cannot list Vercel repo projects",
        method: "GET",
        path: "/api/vercel/repo-projects",
        anonymous: true,
        expect: [401],
      },
      {
        name: "Vercel repo projects requires repoOwner and repoName",
        method: "GET",
        path: "/api/vercel/repo-projects",
        expect: [400],
      },
      {
        // The local identity has no stored Vercel token. Unlike the GitHub
        // routes above, this one degrades correctly: a typed 403 telling the
        // user to connect Vercel.
        name: "Vercel repo projects is a typed 403 without a connected Vercel account",
        method: "GET",
        path: `/api/vercel/repo-projects?repoOwner=${GH_OWNER}&repoName=${GH_REPO}`,
        expect: [403],
        assert: (body) =>
          typeof (body as { error?: string }).error === "string"
            ? null
            : "expected a typed connect-Vercel error message",
      },
      {
        name: "anonymous caller cannot read the workflow catalog",
        method: "GET",
        path: "/api/workflows/catalog",
        anonymous: true,
        expect: [401],
      },
      {
        // The workflowCatalog product surface is not exposed in this
        // environment, so the route 404s by design. When the surface is
        // enabled the same call returns 200 with a `workflows` array.
        name: "workflow catalog is 404 while the product surface is unexposed",
        method: "GET",
        path: "/api/workflows/catalog",
        expect: [200, 404],
        assert: (body) => {
          const payload = body as {
            errorKind?: string;
            workflows?: unknown;
          };
          if (Array.isArray(payload.workflows)) return null;
          return payload.errorKind === "product_surface_disabled"
            ? null
            : `expected a workflows array or errorKind "product_surface_disabled", got ${JSON.stringify(payload).slice(0, 120)}`;
        },
      },
    ],
  },
];

if (import.meta.main) {
  const only = process.argv
    .find((arg) => arg.startsWith("--only="))
    ?.split("=")[1];
  const selected = only
    ? extendedJourneys.filter((j) => j.id === only)
    : extendedJourneys;
  const sections: string[] = [];
  let failed = 0;

  for (const journey of selected) {
    const result = await runJourney(journey);
    if (!result.passed) failed++;
    sections.push(formatJourneyMarkdown(result));
    console.log(
      `${result.passed ? "PASS" : "FAIL"}  ${result.id}  ${result.title}`,
    );
    for (const step of result.steps.filter((s) => !s.ok)) {
      console.log(
        `        ✗ ${step.step} :: ${step.method} ${step.path} -> ${step.status} :: ${step.responseSample.replace(/\n/g, " ").slice(0, 180)}`,
      );
    }
  }

  console.log(
    `\n${selected.length - failed}/${selected.length} journeys passed`,
  );
  await Bun.write(
    new URL("../../docs/api-contracts/extended-journeys.md", import.meta.url)
      .pathname,
    `# API contract: extended journeys\n\nObserved by running \`scripts/api-exercise/journeys-extended.ts\` against a local server.\nThese cover the route paths that \`journeys-core.ts\` does not touch.\n\n${sections.join("\n\n")}\n`,
  );
}
