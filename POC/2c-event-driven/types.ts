/**
 * POC 2c — Event-driven agents (beyond GitHub webhooks).
 *
 * Canonical event model + source/verifier/normalizer/rule contracts.
 *
 * The real codebase already has a *GitHub-only* generalization in
 * `apps/web/lib/background-agents/` (see `types.ts`
 * `NormalizedBackgroundTriggerEvent`, `github-events.ts`, `matching.ts`,
 * `dispatcher.ts`). That model is repo-centric: every event must carry a
 * `repoOwner`/`repoName`, and the only verifier is GitHub's HMAC-SHA256.
 *
 * This POC proves the next step: a source-agnostic `AgentEvent`, a per-source
 * verifier+normalizer registry (each source can verify differently), and a
 * rule engine that is not tied to a single payload shape. GitHub PR-close is
 * subsumed as ONE rule to prove this is not a regression.
 */

/** Canonical, source-agnostic event the rule engine matches against. */
export type AgentEvent = {
  /** Which source emitted this. */
  source: EventSourceId;
  /**
   * Canonical dotted event type, e.g. "github.issues.opened",
   * "email.message.received", "deploy.failed", "sentry.issue.alert".
   */
  type: string;
  /** Stable id used for idempotency / dedup of redelivered webhooks. */
  externalId: string;
  /** Optional repo association (github + some deploy events have it). */
  repo?: { owner: string; name: string };
  /** Who/what triggered it (login, email address, sender id). */
  actor?: string;
  /** One-line human subject (issue title, email subject, deploy name). */
  subject: string;
  /** Longer text body when present (issue body, email text, error message). */
  body?: string;
  /**
   * Flat, source-normalized fields the rule matcher + prompt template read.
   * Keep primitives only so matching + templating stay simple and safe.
   */
  metadata: Record<string, string | number | boolean | null>;
  /** ISO timestamp the source reports for the event (best effort). */
  occurredAt?: string;
};

export const eventSourceIds = [
  "github",
  "agentmail",
  "vercel-deploy",
  "sentry",
  "generic",
] as const;

export type EventSourceId = (typeof eventSourceIds)[number];

/** Raw inbound request as the ingest endpoint sees it. */
export type RawInbound = {
  /** Raw request body bytes/string — verification MUST use the raw text. */
  rawBody: string;
  headers: Record<string, string>;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * An event source bundles the three per-source concerns the GitHub route
 * conflates inline: deciding if a payload belongs to this source, verifying
 * its signature with that source's scheme, and normalizing to AgentEvent.
 */
export type EventSource = {
  id: EventSourceId;
  /**
   * Cheap routing predicate from headers (e.g. presence of
   * `x-github-event` vs `x-agentmail-signature`). The ingest endpoint uses
   * this to pick the source before verifying.
   */
  matchesInbound: (inbound: RawInbound) => boolean;
  /**
   * Verify the request authenticity using this source's scheme. Each source
   * differs: GitHub `sha256=<hex>` HMAC, AgentMail bare-hex HMAC-SHA256,
   * Vercel HMAC-SHA1 hex, Sentry HMAC-SHA256 hex, generic shared bearer.
   */
  verify: (inbound: RawInbound, secret: string) => VerifyResult;
  /**
   * Map a verified raw payload to zero or more canonical events. Returns []
   * for payloads this source recognizes but does not translate (e.g. a
   * GitHub `ping`, or an email `message.sent` we ignore).
   */
  normalize: (parsed: unknown, inbound: RawInbound) => AgentEvent[];
};

/** A single field match: equality, membership, prefix, or substring. */
export type FieldMatcher =
  | { equals: string | number | boolean }
  | { in: Array<string | number> }
  | { prefix: string }
  | { contains: string };

/**
 * A trigger rule. `when` selects events; `action` describes the agent-run
 * intent to produce. Mirrors the production
 * `backgroundAgentTriggers.conditions` idea but generalized off `match`.
 */
export type TriggerRule = {
  id: string;
  description: string;
  enabled: boolean;
  when: {
    source: EventSourceId;
    /** Exact canonical type OR a "source.*"-style prefix. */
    type: string;
    /**
     * Additional constraints against AgentEvent fields. Dotted keys read
     * nested fields: "metadata.action", "repo.owner", "subject".
     */
    match?: Record<string, FieldMatcher>;
  };
  action: {
    /** Logical agent/target to wake. */
    agentId: string;
    /** Optional explicit target repo; else inherited from the event. */
    targetRepo?: { owner: string; name: string };
    /**
     * Prompt with `{{field}}` placeholders filled from the AgentEvent
     * (same dotted-key access as `match`).
     */
    promptTemplate: string;
  };
};

/** The intent emitted when a rule matches an event. */
export type AgentRunIntent = {
  ruleId: string;
  agentId: string;
  repo?: { owner: string; name: string };
  prompt: string;
  /** Idempotency key for dedup of redelivered webhooks. */
  idempotencyKey: string;
  event: AgentEvent;
};

/**
 * The seam (mirrors POC 2a's `runAgent(intent)`): the dispatcher calls this to
 * actually wake an agent. In production this materializes a run the same way
 * `apps/web/app/workflows/chat.ts` does for an interactive turn / the way
 * `dispatcher.ts` -> `runBackgroundAgentWorkflow` does for a trigger. In the
 * eval we inject a fake that just records the intent.
 */
export type RunAgent = (intent: AgentRunIntent) => Promise<{ runId: string }>;
