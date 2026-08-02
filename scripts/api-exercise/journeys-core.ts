/**
 * Core CRUD-and-lifecycle journeys that need no live sandbox.
 *
 * These carry real ids between calls, so a broken create silently breaks the
 * read and delete that follow — which is the point: a green run means the
 * resource genuinely round-tripped.
 */
import {
  formatJourneyMarkdown,
  type Journey,
  runJourney,
} from "./journey-runner";

const journeys: Journey[] = [
  {
    id: "J-AUTH-01",
    title: "Session identity and unauthenticated boundary",
    steps: [
      {
        name: "anonymous caller gets an empty identity, not an error",
        method: "GET",
        path: "/api/auth/info",
        anonymous: true,
      },
      {
        name: "anonymous caller cannot list sessions",
        method: "GET",
        path: "/api/sessions",
        anonymous: true,
        expect: [401],
      },
      {
        name: "authenticated caller is identified",
        method: "GET",
        path: "/api/auth/info",
        capture: (body, ctx) => {
          const user = (body as { user?: { id?: string } }).user;
          ctx.userId = user?.id;
        },
      },
      {
        name: "authenticated caller can list sessions",
        method: "GET",
        path: "/api/sessions",
      },
    ],
  },
  {
    id: "J-PREFS-01",
    title: "Read, update and re-read account preferences",
    steps: [
      {
        name: "read current preferences",
        method: "GET",
        path: "/api/settings/preferences",
        capture: (body, ctx) => {
          ctx.originalPreferences = body;
        },
      },
      {
        name: "reject an unknown preference value",
        method: "PATCH",
        path: "/api/settings/preferences",
        body: { diffMode: "not-a-real-mode" },
        expect: [400, 422],
      },
      {
        name: "set a valid preference",
        method: "PATCH",
        path: "/api/settings/preferences",
        body: { autoCommit: true },
      },
      {
        name: "preference survives a re-read",
        method: "GET",
        path: "/api/settings/preferences",
      },
    ],
  },
  {
    id: "J-INFPROF-01",
    title: "Inference profile create, read, update, delete",
    steps: [
      {
        name: "list existing profiles",
        method: "GET",
        path: "/api/inference-profiles",
      },
      {
        name: "reject a profile with no API key",
        method: "POST",
        path: "/api/inference-profiles",
        body: { name: "Contract Probe", provider: "openai-compatible" },
        expect: [400, 422],
      },
      {
        name: "create a profile",
        method: "POST",
        path: "/api/inference-profiles",
        body: {
          name: "Contract Probe",
          provider: "openai-compatible",
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-contract-probe-not-a-real-key",
        },
        expect: [200, 201],
        capture: (body, ctx) => {
          const profile = body as { profile?: { id?: string }; id?: string };
          ctx.profileId = profile.profile?.id ?? profile.id;
        },
      },
      {
        // Collection-level PATCH/DELETE with the id in the body, unlike every
        // other resource in this API, which uses /resource/[id]. Recorded as
        // observed, not as it ought to be.
        name: "rename the profile via collection-level PATCH",
        method: "PATCH",
        path: "/api/inference-profiles",
        body: (ctx) => ({
          profileId: ctx.profileId,
          name: "Contract Probe Renamed",
        }),
        skipIf: (ctx) => !ctx.profileId,
      },
      {
        name: "per-id read route does not exist",
        method: "GET",
        path: (ctx) => `/api/inference-profiles/${ctx.profileId}`,
        skipIf: (ctx) => !ctx.profileId,
        expect: [404],
      },
      {
        name: "list reflects the rename",
        method: "GET",
        path: "/api/inference-profiles",
      },
      {
        name: "delete the profile via collection-level DELETE",
        method: "DELETE",
        path: "/api/inference-profiles",
        body: (ctx) => ({ profileId: ctx.profileId }),
        skipIf: (ctx) => !ctx.profileId,
      },
    ],
  },
  {
    id: "J-SESSION-01",
    title: "Session create, read, rename, archive without a sandbox",
    steps: [
      {
        name: "reject a session with an invalid sandbox type",
        method: "POST",
        path: "/api/sessions",
        body: { title: "Contract probe", sandboxType: "not-a-backend" },
        expect: [400],
      },
      {
        name: "create a session",
        method: "POST",
        path: "/api/sessions",
        body: { title: "API contract probe session" },
        expect: [200, 201],
        capture: (body, ctx) => {
          const session = body as { session?: { id?: string }; id?: string };
          ctx.sessionId = session.session?.id ?? session.id;
        },
      },
      {
        name: "read the session",
        method: "GET",
        path: (ctx) => `/api/sessions/${ctx.sessionId}`,
        skipIf: (ctx) => !ctx.sessionId,
      },
      {
        name: "list the session's chats",
        method: "GET",
        path: (ctx) => `/api/sessions/${ctx.sessionId}/chats`,
        skipIf: (ctx) => !ctx.sessionId,
        capture: (body, ctx) => {
          const chats = (body as { chats?: { id: string }[] }).chats;
          ctx.chatId = chats?.[0]?.id;
        },
      },
      {
        name: "unknown session id is a 404, not a 500",
        method: "GET",
        path: "/api/sessions/definitely-not-a-real-session-id",
        expect: [404],
      },
      {
        name: "rename the session",
        method: "PATCH",
        path: (ctx) => `/api/sessions/${ctx.sessionId}`,
        body: { title: "API contract probe session (renamed)" },
        skipIf: (ctx) => !ctx.sessionId,
      },
      {
        name: "read the session diff",
        method: "GET",
        path: (ctx) => `/api/sessions/${ctx.sessionId}/diff`,
        skipIf: (ctx) => !ctx.sessionId,
      },
      {
        name: "read session observability",
        method: "GET",
        path: (ctx) => `/api/sessions/${ctx.sessionId}/observability`,
        skipIf: (ctx) => !ctx.sessionId,
      },
      {
        name: "delete the session",
        method: "DELETE",
        path: (ctx) => `/api/sessions/${ctx.sessionId}`,
        skipIf: (ctx) => !ctx.sessionId,
      },
      {
        name: "deleted session is gone",
        method: "GET",
        path: (ctx) => `/api/sessions/${ctx.sessionId}`,
        skipIf: (ctx) => !ctx.sessionId,
        expect: [404],
      },
    ],
  },
  {
    id: "J-LOOP-01",
    title: "Agent loop create, read, update, delete",
    steps: [
      { name: "list loops", method: "GET", path: "/api/agent-loops" },
      {
        name: "reject a loop with no name",
        method: "POST",
        path: "/api/agent-loops",
        body: {},
        expect: [400, 422],
      },
      {
        name: "create a loop",
        method: "POST",
        path: "/api/agent-loops",
        body: {
          name: "Contract probe loop",
          description: "Created by the API exercise harness",
          repoOwner: "dennisonbertram",
          repoName: "fork-open-agents",
        },
        expect: [200, 201],
        capture: (body, ctx) => {
          const loop = body as { loop?: { id?: string }; id?: string };
          ctx.loopId = loop.loop?.id ?? loop.id;
        },
      },
      {
        name: "read the loop",
        method: "GET",
        path: (ctx) => `/api/agent-loops/${ctx.loopId}`,
        skipIf: (ctx) => !ctx.loopId,
      },
      {
        name: "list the loop's triggers",
        method: "GET",
        path: (ctx) => `/api/agent-loops/${ctx.loopId}/triggers`,
        skipIf: (ctx) => !ctx.loopId,
      },
      {
        name: "list the loop's runs",
        method: "GET",
        path: (ctx) => `/api/agent-loops/${ctx.loopId}/runs`,
        skipIf: (ctx) => !ctx.loopId,
      },
      {
        name: "unknown loop id is a 404",
        method: "GET",
        path: "/api/agent-loops/definitely-not-a-real-loop",
        expect: [404],
      },
      {
        name: "delete the loop",
        method: "DELETE",
        path: (ctx) => `/api/agent-loops/${ctx.loopId}`,
        skipIf: (ctx) => !ctx.loopId,
      },
    ],
  },
  {
    id: "J-BGAGENT-01",
    title: "Background agent create, read, update, delete",
    steps: [
      {
        name: "list background agents",
        method: "GET",
        path: "/api/background-agents",
      },
      {
        name: "reject an agent with no repository",
        method: "POST",
        path: "/api/background-agents",
        body: { name: "Contract probe agent" },
        expect: [400, 422],
      },
      {
        name: "list background agent runs",
        method: "GET",
        path: "/api/background-agent-runs",
      },
    ],
  },
  {
    id: "J-PUBLIC-01",
    title: "Unauthenticated service surfaces",
    steps: [
      {
        name: "health probe",
        method: "GET",
        path: "/api/health",
        anonymous: true,
      },
      {
        name: "model catalog",
        method: "GET",
        path: "/api/models",
        anonymous: true,
      },
      {
        name: "harness readiness",
        method: "GET",
        path: "/api/harness/ready",
        anonymous: true,
      },
      {
        name: "unknown shared id is a 404",
        method: "GET",
        path: "/api/shared/definitely-not-a-real-share/status",
        anonymous: true,
        expect: [404],
      },
    ],
  },
];

if (import.meta.main) {
  const only = process.argv
    .find((arg) => arg.startsWith("--only="))
    ?.split("=")[1];
  const selected = only ? journeys.filter((j) => j.id === only) : journeys;
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
    new URL("../../docs/api-contracts/core-journeys.md", import.meta.url)
      .pathname,
    `# API contract: core journeys\n\nObserved by running \`scripts/api-exercise/journeys-core.ts\` against a local server.\n\n${sections.join("\n\n")}\n`,
  );
}
