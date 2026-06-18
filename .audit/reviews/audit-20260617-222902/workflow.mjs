// Deep adversarial code review of fork-open-agents.
// Goal: find REAL medium+ defects, suppress false positives via 3-lens
// adversarial verification, dedupe across domains, format as bug-regression
// issues. Each reviewer keeps an audit scratchpad for traceability.
export const meta = {
  name: 'app-deep-review',
  description: 'Deep adversarial code review of fork-open-agents: 20 domain reviewers with audit scratchpads, 3-lens code-grounded verification per medium+ finding to kill false positives, cross-domain dedupe, bug-regression issue formatting',
  phases: [
    { title: 'Review', detail: '20 domain reviewers each keep an audit scratchpad' },
    { title: 'Verify', detail: '3 independent code-grounded skeptics per medium+ finding' },
    { title: 'Synthesize', detail: 'dedupe, set severity, format bug-regression issues, write audit' },
  ],
}

const REPO = args.repoRoot
const AUDIT = args.auditDir
const OPEN_ISSUES_PATH = AUDIT + '/open-issues.txt'

const DOMAINS = [
  {
    key: 'auth-sessions',
    title: 'Auth, OAuth callbacks & session ownership',
    brief: 'Better Auth config, Vercel + GitHub-App OAuth callbacks, session creation/ownership/onboarding. Paths: apps/web/lib/auth, apps/web/app/api/auth, apps/web/app/api/sessions, apps/web/lib/session, apps/web/lib/onboarding. Focus: missing state/nonce validation on OAuth callbacks, cookies dropped on redirect responses, dynamic-route param-name mismatches yielding undefined, session-scoped data fetched without an ownership check, redirect-safety, BETTER_AUTH_URL derivation.',
  },
  {
    key: 'chat-streaming',
    title: 'Chat request lifecycle & streaming',
    brief: 'Chat request/stream/message persistence, activeStreamId ownership, onFinish/teardown/resume, optimistic UI rollback, resumable/abortable streams, auto-commit. Paths: apps/web/app/api/chat, apps/web/lib/chat, apps/web/lib/chat-streaming-state, apps/web/lib/chat-instance-manager, apps/web/lib/abortable-chat-transport, apps/web/lib/chat-auto-commit, apps/web/lib/chat-route-cleanup. Focus: stale activeStreamId tokens, request-start snapshot ownership/scope guards, onFinish-only persistence gaps across route switches, double-retry replay/flicker, premature interrupted marking, post-turn automations that only run client-side.',
  },
  {
    key: 'sandbox-lifecycle',
    title: 'Sandbox create/resume/snapshot/reconnect/lifecycle',
    brief: 'Sandbox create/resume/snapshot/reconnect/status, lifecycle workflow kicks & timers, timeout clamps, idempotency. Paths: apps/web/lib/sandbox, apps/web/app/api/sandbox, apps/web/app/api/sessions/[sessionId]/sandbox, apps/web/app/api/sessions/[sessionId]/sandbox-services. Focus: treating snapshot as non-disruptive, 18_000_000ms timeout clamp, lifecycle not durable without a workflow run, expired/no_sandbox/expired-as-no_sandbox handling, persisting lifecycleRunId before start(), skipped/not-due-yet retry, reconnect persisting refreshed runtime state, probe timeouts treated as terminal.',
  },
  {
    key: 'sandbox-ui-state',
    title: 'Sandbox UI state derivation & polling',
    brief: 'Chat workspace sandbox chip/overlay/indicator-dot heuristics, lifecycle countdown, auto-resume, status polling cadence, request loops. Paths under apps/web/app/sessions/[sessionId]/chats/[chatId] that derive sandbox status, plus hooks (apps/web/hooks) touching sandbox/status. Focus: contradictory chip-vs-dot states, missing time dependency in memoized validity, reconnect poll mutating activity timestamps, snapshotUrl-only hibernation inference, auto-resume gating, server-authoritative state drift, infinite request loops on status sync.',
  },
  {
    key: 'git-github',
    title: 'Git ops & GitHub App install/sync/webhooks/PR',
    brief: 'Git branch/commit/PR/discard, GitHub App install/sync/webhooks, fork-push PR fallback, branch safety, connection status. Paths: apps/web/lib/git, apps/web/lib/github, apps/web/app/api/github, apps/web/app/api/sessions/[sessionId]/git, apps/web/app/api/generate-pr. Focus: webhook/callback trusting query params without state/CSRF, installation sync pruning from a partial page, fork-push not retrying transient not-found, push-denied detected only by text match, missing 403 fast-fail on lost push access, branch-safety UX that lets writes hit main.',
  },
  {
    key: 'background-agents-loops',
    title: 'Background agents & loops (triggers/cron/grants/runs)',
    brief: 'Background agent triggers/cron/grants/runs/events, webhook authz, schedule builder, agent spec, run polling, loops. Paths: apps/web/lib/background-agents, apps/web/lib/agent-loops, apps/web/app/api/background-agents, apps/web/app/api/agent-loops, apps/web/app/api/background-agent-runs. NOTE: several files here are new/untracked (schedule-builder, agent-spec) and recently changed (deployment-status-e2e, session). Focus: webhook endpoint authz (publicId spoofing), cron schedule correctness/timezones, durable workflow registration (top-level import + start), FK shape on run/event inserts, trigger condition evaluation, grant enforcement, run retry/cancel/pause/resume races.',
  },
  {
    key: 'managed-runtime',
    title: 'Managed runtime profiles, workers & tool boundary',
    brief: 'Runtime profiles (setup/verification probes), worker attribution, managed-mode tool-boundary enforcement, profile drafts. Paths: apps/web/lib/managed-runtime, apps/web/lib/dev, apps/web/app/api/sessions/[sessionId]/managed-runtime, apps/web/app/api/settings/runtime-profiles. Focus: assuming a toolchain exists in every sandbox, false coordinator-vs-worker attribution of nested bash, tool boundary only as prompt guidance (not enforced), profile draft never emitted leaving composer disabled, observability persisting raw stdout vs redacted summaries, PATH not including the shim dir.',
  },
  {
    key: 'verified-build',
    title: 'Verified build bridge/contracts/events',
    brief: 'Verified build bridge, contracts, events, go/no-go, idempotency. Paths: apps/web/lib/verified-build and related API routes. Focus: idempotency races, dead/always-failing CTAs, SSE reconnect storms, authz/timeout gaps on run/event endpoints, event dedup vs the session ledger.',
  },
  {
    key: 'composio',
    title: 'Composio connect/toolkits/accounts/grants',
    brief: 'Composio connect/connected-accounts/toolkits, proposeToolAction injection, grants. Paths: apps/web/lib/composio, apps/web/app/api/composio. Focus: proposeToolAction never injected (known live bug #388 - verify current state and find the injection gap if still broken), token/credential leakage in responses, missing ownership on connected-account reads/deletes, toolkit listing exposure.',
  },
  {
    key: 'workflows-harness',
    title: 'Durable workflows & harness run control',
    brief: 'Durable workflow registration/catalog, harness runs/workcells/approve/audit/trace/repair/cancel. Paths: apps/web/lib/workflows, apps/web/lib/harness, apps/web/app/api/workflows/catalog, apps/web/app/api/harness. Focus: "use step" missing on Node-using functions called from workflow bodies (silent runtime fail), dynamic-only workflow imports not registered (start() no-op), FK violation on event/run inserts invisible to mocks, approve/cancel state-machine races, trace export authz.',
  },
  {
    key: 'inference-models',
    title: 'Inference profiles & model catalog/variants',
    brief: 'Inference profiles, model list/variants/availability/context/roles/options. Paths: apps/web/lib/inference, apps/web/lib/models*, apps/web/lib/model-*, apps/web/app/api/models, apps/web/app/api/inference-profiles. Focus: API key/provider-token leakage, profile test endpoint exposing secrets, availability/context miscalculation, unauthenticated model-list exposure, variant mutation authz.',
  },
  {
    key: 'usage-billing',
    title: 'Usage events, rollups, rank & cost/budget',
    brief: 'Usage events, messageCount rollups, leaderboard rank, cost/budget enforcement. Paths: apps/web/lib/usage, apps/web/app/api/usage, apps/web/app/api/usage/rank. Focus: messageCount counting raw rows vs assistant turns (inflated totals), per-run attribution gaps, public /u/{username} 404/enabled-state disclosure, rank computation SQL correctness, budget-halt not enforced server-side.',
  },
  {
    key: 'skills-mcp',
    title: 'Skills discovery/install & MCP servers',
    brief: 'Skill discovery/override ordering, install paths, MCP server registration/tools. Paths: apps/web/lib/skills, apps/web/lib/skills-cache, apps/web/lib/mcp, apps/web/app/api/settings/skills, apps/web/app/api/settings/mcp-servers. Focus: skill de-dup ordering (project before user), install hooks missing one of the two setup paths, MCP server tool-injection authz, skill generation endpoint safety, mock.module stub gaps.',
  },
  {
    key: 'observability-redaction',
    title: 'Structured events, redaction & session ledger',
    brief: 'Structured events, secret/PII/log/artifact redaction, session ledger dedup. Paths: apps/web/lib/observability and redaction helpers across lib. Focus: secrets/provider-tokens/prompt content reaching logs or tool-output surfaces, duplicate user-visible events for replayed harness SSE, missing redaction in managed-worker output beyond .env, correlation IDs absent on key paths.',
  },
  {
    key: 'settings-mutations',
    title: 'Settings surfaces & data mutations (authz)',
    brief: 'Settings forms/server actions, repo settings, mutation ownership. Paths: apps/web/app/api/settings, apps/web/lib/repo-settings, apps/web/app/settings. Focus: settings writes missing user/admin ownership checks (IDOR on preferences/agents/model-variants/runtime-profiles/skills), server-action vs API testability gaps, operator-vs-user (isAdmin) separation leaks, repo settings scoped to wrong owner.',
  },
  {
    key: 'vercel-deployment',
    title: 'Vercel integration, env-sync, project linking, OIDC',
    brief: 'Vercel integration, env sync, project linking, OIDC token handling, repo-projects. Paths: apps/web/lib/vercel, apps/web/lib/deployment, apps/web/app/api/vercel. Focus: OIDC JWT used after expiry without refresh, env-sync decision gaps in new-session funnel, project-linking assumptions, repo-projects authz, Workflow observability 401 handling, secret leakage in env responses.',
  },
  {
    key: 'api-authz-idor',
    title: 'API authorization & IDOR (cross-cutting security)',
    brief: 'HORIZONTAL SECURITY SWEEP across the ~133 API routes. Prioritize MUTATION and cross-tenant routes: /sessions/[sessionId]/** (chats, git, sandbox, files, managed-runtime), /background-agents/**, /agent-loops/**, /settings/**, /github/create-repo, /composio/connect. For each, ask: does this route verify the authenticated user OWNS the sessionId/chatId/agentId/runId/profileId/repo before reading/mutating? Find concrete IDOR (user A acts on user B resources), missing auth checks, unauthenticated endpoints that should be authed. Paths: apps/web/lib/rate-limit, apps/web/lib/redirect-safety, route handlers generally. Sample the highest-risk ~30 routes deeply; list any route lacking an ownership check with file:line.',
  },
  {
    key: 'db-schema-migrations',
    title: 'DB schema integrity, FK/transactions, migration safety',
    brief: 'Schema integrity, FK/transaction boundaries, migration safety/drift. Paths: apps/web/lib/db (schema.ts + migrations). Focus: FK constraints absent where a parent id is referenced (runtime-only PG 23503), missing transactions across multi-write sequences, non-idempotent migrations (ADD COLUMN without IF NOT EXISTS), generated migration drift on untouched columns, unique constraints missing where dedup matters (e.g., ownership/lease rows), cascading deletes that orphan related rows.',
  },
  {
    key: 'agent-package',
    title: 'packages/agent: openAgent, tool policy, subagents',
    brief: 'openAgent ToolLoopAgent, per-mode tool policy, explorer/executor subagents (task delegation), classic vs managed_runtime modes, tool implementations (file/bash/fetch/task). Paths: packages/agent. Focus: tool-policy holes (managed mode still exposing direct mutation tools to coordinator), unbounded recursion/loops, tool-result parsing assuming shape without narrowing, error propagation gaps, prompt injection surface in fetched/forked content, sandbox attribution missing on delegated worker outputs.',
  },
  {
    key: 'sandbox-shared-packages',
    title: 'packages/sandbox backend + packages/shared utilities',
    brief: 'Sandbox backend abstraction (Vercel/Hetzner connect), shared diff/tool-state/paste-block utilities. Paths: packages/sandbox, packages/shared. Focus: sandbox provider abstraction leaks, domain()/port assumptions throwing, snapshot/restore idempotency, diff parsing correctness, tool-state serialization races, untrusted-content handling in diff/paste-blocks.',
  },
]

const LENSES = [
  {
    key: 'repro',
    angle: 'REPRODUCTION/CORRECTNESS. Independently read the cited files and trace the real execution path. Decide whether the defect ACTUALLY manifests. Try to construct a concrete trigger (inputs, sequence, state). If the cited code does not match the description, or no real path reaches the defect, or the trigger is impossible, REFUTE.',
  },
  {
    key: 'guard',
    angle: 'GUARD/FRAMEWORK/CONTEXT. Hunt for an existing protection that already prevents the defect: an upstream ownership/authz check, input validation/Zod schema, DB constraint/unique index, middleware, framework behavior, retry/idempotency layer, or UI guard. If such a protection fully covers the described scenario, REFUTE (or downgrade). Be specific about where the guard lives.',
  },
  {
    key: 'steelman',
    angle: 'STEELMAN + SEVERITY. Make the strongest, most honest case that the code is actually fine as written. Then assess the REAL-WORLD impact and correct the severity. A purely theoretical defect with no realistic trigger, or one whose impact is negligible, should be downgraded to low or marked uncertain. Do not confirm just because it "could" happen.',
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: { type: 'string' },
    scratchpadPath: { type: 'string' },
    summary: { type: 'string', description: '2-4 sentences on what was reviewed and overall risk posture' },
    coverageGaps: { type: 'array', items: { type: 'string' }, description: 'areas in this domain you could not fully cover; suggest follow-up' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'domainKey-N, e.g. chat-streaming-1' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string', enum: ['correctness', 'security', 'authz', 'reliability', 'concurrency', 'data-integrity', 'performance', 'observability'] },
          files: { type: 'array', items: { type: 'string' }, description: 'file:line references that must be real and verified' },
          observed: { type: 'string', description: 'what the code actually does / the defect, WITH a short code excerpt' },
          trigger: { type: 'string', description: 'concrete realistic scenario that exposes it' },
          impact: { type: 'string' },
          proposedRegressionTest: { type: 'string', description: 'smallest test that would fail red before a fix' },
          proposedFix: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          knownIssueCheck: { type: 'string', description: 'does this duplicate a lessons-learned item or open issue? say so explicitly, or "no match"' },
        },
        required: ['id', 'title', 'severity', 'category', 'files', 'observed', 'trigger', 'impact', 'proposedRegressionTest', 'proposedFix', 'confidence', 'knownIssueCheck'],
      },
    },
  },
  required: ['domain', 'scratchpadPath', 'summary', 'coverageGaps', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lens: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] },
    filesRead: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string', description: 'grounded in code you actually read; cite file:line and quote the decisive lines' },
    correctedSeverity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'your independent severity, or the original if unchanged' },
    falsePositiveNote: { type: 'string', description: 'if refuted/uncertain, the precise reason this is not a real/medium+ bug' },
  },
  required: ['lens', 'verdict', 'filesRead', 'reasoning', 'correctedSeverity'],
}

const SYNTHESIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summaryPath: { type: 'string' },
    confirmedIssues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'prefixed "fix: ..."' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium'] },
          category: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          body: { type: 'string', description: 'full markdown in the bug-regression template shape' },
          sourceFindings: { type: 'array', items: { type: 'string' } },
          scratchpadPaths: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'severity', 'category', 'labels', 'body', 'sourceFindings', 'scratchpadPaths'],
      },
    },
    droppedAsFalsePositive: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['title', 'reason'],
      },
    },
    dedupedAgainstOpenIssues: { type: 'array', items: { type: 'string' } },
    counts: {
      type: 'object',
      additionalProperties: false,
      properties: {
        totalCandidateFindings: { type: 'number' },
        verifiedSurvivors: { type: 'number' },
        confirmedIssues: { type: 'number' },
        droppedFalsePositives: { type: 'number' },
        truncated: { type: 'boolean' },
      },
      required: ['totalCandidateFindings', 'verifiedSurvivors', 'confirmedIssues', 'droppedFalsePositives', 'truncated'],
    },
  },
  required: ['summaryPath', 'confirmedIssues', 'droppedAsFalsePositive', 'dedupedAgainstOpenIssues', 'counts'],
}

function reviewPrompt(d) {
  return [
    'You are a senior reviewer auditing ONE bounded domain of a production Next.js App Router monorepo (dennisonbertram/fork-open-agents) for REAL, high-impact defects. The #1 enemy is FALSE POSITIVES - only raise something you can prove with specific code and a concrete trigger.',
    '',
    'REPO ROOT: ' + REPO,
    'AUDIT SCRATCHPAD PATH: ' + AUDIT + '/' + d.key + '.md',
    '',
    'DOMAIN: ' + d.title,
    'SCOPE: ' + d.brief,
    '',
    'STEP 1 (mandatory): Read ' + REPO + '/docs/agents/lessons-learned.md in full. These are KNOWN lessons (many describe fixes already applied). Do NOT report a known lesson whose fix is already in place as a new bug. You MAY report a finding only where you find a NEW code location where the fix for such a lesson is MISSING.',
    '',
    'STEP 2: Keep an audit scratchpad at the path above. As you work, WRITE (and keep updating) it with: (a) the files you read, (b) your assumptions about how the app works and any corrections you make as you learn more, (c) candidate defects you considered and why you accepted or rejected each, (d) coverage gaps. This scratchpad is the audit trail another engineer will read - keep it honest and current. Create it early and append as you go.',
    '',
    'STEP 3: Hunt for real defects across your domain: correctness bugs, security/authz holes (IDOR, missing ownership checks, CSRF/state, secret leakage), reliability & concurrency issues (races, missing retries, non-durable lifecycle), data-integrity risks (FK/transaction/unique-constraint gaps), error-handling failures, resource leaks, and broken framework usage. Read the actual route handlers and lib modules - do not skim.',
    '',
    'STRICT RULES:',
    '- Every finding MUST cite real file:line references that you personally verified exist.',
    '- Every finding MUST have a concrete, realistic trigger (not "could theoretically").',
    '- Skip style nits, formatting, hypotheticals, and anything already covered by a lessons-learned fix or an open issue.',
    '- Rate severity honestly: critical = exploitable security/data-loss or wide outage; high = serious functional defect on a protected path; medium = real defect with bounded impact; low = minor.',
    '- Rate confidence honestly. If confidence is low or you cannot name a trigger, do not raise it.',
    '',
    'Return your findings via the structured output. Set scratchpadPath to the absolute path of the scratchpad you wrote. Be the reviewer who finds real bugs, not the one who pads the list.',
  ].join('\n')
}

function verifyPrompt(f, lens) {
  return [
    'A code reviewer claims the following defect exists in this codebase. Your job is to INDEPENDENTLY verify or refute it by READING THE ACTUAL CODE. Do not trust the description - confirm or break it from the source.',
    '',
    'REPO ROOT: ' + REPO,
    '',
    'CLAIMED FINDING:',
    '- Title: ' + f.title,
    '- Severity (claimed): ' + f.severity,
    '- Category: ' + f.category,
    '- Files: ' + (f.files || []).join(', '),
    '- Observed: ' + f.observed,
    '- Trigger: ' + f.trigger,
    '- Impact: ' + f.impact,
    '',
    'YOUR LENS: ' + lens.angle,
    '',
    'REQUIRED STEPS:',
    '1. Read the cited files (and adjacent code they call) at the cited locations. Verify the code actually says what the claim says.',
    '2. ' + lens.angle,
    '3. Cross-check ' + REPO + '/docs/agents/lessons-learned.md and the open-issue list at ' + OPEN_ISSUES_PATH + ': if this is a known/resolved lesson or duplicates an open issue, that is grounds to REFUTE as duplicate/known.',
    '4. Set your own correctedSeverity independently of the claim.',
    '',
    'BAR: We will only file medium+ bugs that survive scrutiny. If you cannot find concrete code evidence the defect is real and reachable, return uncertain or refuted - do not rubber-stamp. Cite file:line and quote the decisive lines in your reasoning.',
  ].join('\n')
}

function synthesizePrompt(payloadText) {
  return [
    'You are the triage/synthesis reviewer for a deep adversarial code review of fork-open-agents. Multiple domain reviewers raised candidate defects; each was independently checked by 3 adversarial verifiers. Below are the findings that SURVIVED verification, plus the ones REFUTED (for audit), plus low-severity items.',
    '',
    'REPO ROOT: ' + REPO,
    'AUDIT DIR: ' + AUDIT,
    '',
    'YOUR TASKS:',
    '1. DEDUPE across domains: merge findings with the same root cause into one issue; record merged source finding ids.',
    '2. EXCLUDE anything that duplicates an EXISTING OPEN ISSUE. Read the open-issue list at ' + OPEN_ISSUES_PATH + ' and drop matches (list their titles in dedupedAgainstOpenIssues). Also exclude anything that merely restates a resolved lessons-learned fix.',
    '3. Keep only MEDIUM and above for filing. Set the final severity using the verifier-corrected severities plus your own judgment (you may read code to confirm).',
    '4. For each kept issue, write a GitHub issue body in the repo bug-regression template shape with these sections: Observed behavior, Expected behavior, Forbidden behavior, Reproduction, Regression test plan (name a smallest failing test + behavior/integration proof), Blast radius, Observability evidence (structured events/error kinds/correlation IDs/redaction/debug recipes per docs/process/feature-ticket-format.md), Research and context sources, Agent todo checklist (concrete, file/command-named), TDD audit trail, Definition of done. Title must be prefixed "fix: ".',
    '5. Labels per issue: ["type:bug", "type:regression", "severity:<level>"] (and "bug" is optional). Use the real severity.',
    '6. Write audit files: ' + AUDIT + '/CONFIRMED-ISSUES.md (the issues, with severity + source findings + scratchpad refs), ' + AUDIT + '/DROPPED-FALSE-POSITIVES.md (every refuted/uncertain finding with the reason it was dropped), and ' + AUDIT + '/COVERAGE-GAPS.md (aggregate reviewer coverage gaps). Set summaryPath to ' + AUDIT + '/CONFIRMED-ISSUES.md.',
    '7. If more than 50 issues survive, keep the 50 highest-severity and set counts.truncated = true (note truncation in CONFIRMED-ISSUES.md).',
    '',
    'Be rigorous: a defect only becomes a confirmed issue if it is real, medium+, not a duplicate, and backed by the verification evidence. Populate droppedAsFalsePositive from the refuted set so the audit shows what the adversarial pass caught.',
    '',
    '=== PAYLOAD (survivors, refuted, lows) ===',
    payloadText,
  ].join('\n')
}

// ---------- REVIEW + VERIFY (serialized: 1 domain at a time, 1 finding at a time) ----------
// Serialized on purpose: a fully concurrent pipeline exceeded this provider's
// request-rate limit (429) and killed 18/20 reviewers. Peak concurrency here
// is ~3 (the 3 lenses for a single finding), which stays under the limit.
phase('Review')
log('Reviewing ' + DOMAINS.length + ' domains SERIALLY (rate-limit safe); 3-lens verification per medium+ finding, one finding at a time.')

const perDomain = []
for (let i = 0; i < DOMAINS.length; i++) {
  const d = DOMAINS[i]
  log('[' + (i + 1) + '/' + DOMAINS.length + '] review:' + d.key)
  let review = await agent(reviewPrompt(d), { label: 'review:' + d.key, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' })
  if (!review) {
    log('review:' + d.key + ' returned null once — retrying once (likely transient rate limit)')
    review = await agent(reviewPrompt(d), { label: 'review:' + d.key + ':retry', phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' })
  }
  if (!review || !Array.isArray(review.findings)) {
    perDomain.push({ domain: d.key, scratchpadPath: review && review.scratchpadPath, summary: (review && review.summary) || 'review failed', survivors: [], refuted: [], lows: [], coverageGaps: ['REVIEW FAILED — needs manual re-run'] })
    continue
  }
  const fileable = review.findings.filter((f) => f.severity !== 'low')
  const lows = review.findings.filter((f) => f.severity === 'low')
  const checked = []
  for (let j = 0; j < fileable.length; j++) {
    const f = fileable[j]
    const verdicts = (await parallel(LENSES.map((lens) => () =>
      agent(verifyPrompt(f, lens), { label: 'verify:' + d.key + ':' + lens.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'medium' }).catch(() => null)
    ))).filter(Boolean)
    const confirmed = verdicts.filter((v) => v.verdict === 'confirmed').length
    const refuted = verdicts.filter((v) => v.verdict === 'refuted').length
    const survives = confirmed >= 2 && refuted === 0
    checked.push({ finding: f, verdicts, survives, confirmed, refuted })
    log('  verify ' + f.id + ' -> ' + (survives ? 'SURVIVES' : 'dropped') + ' (confirmed=' + confirmed + ' refuted=' + refuted + ')')
  }
  perDomain.push({
    domain: d.key,
    scratchpadPath: review.scratchpadPath,
    summary: review.summary,
    coverageGaps: review.coverageGaps || [],
    survivors: checked.filter((c) => c.survives),
    refuted: checked.filter((c) => !c.survives),
    lows: lows,
  })
}

// ---------- Gather ----------
const clean = perDomain.filter(Boolean)
const allSurvivors = clean.flatMap((r) => r.survivors.map((s) => ({ domain: r.domain, ...s })))
const allRefuted = clean.flatMap((r) => r.refuted.map((s) => ({ domain: r.domain, ...s })))
const allLows = clean.flatMap((r) => r.lows.map((f) => ({ domain: r.domain, finding: f })))
const coverageGaps = clean.flatMap((r) => (r.coverageGaps || []).map((g) => r.domain + ': ' + g))

log('Verification complete. Survivors: ' + allSurvivors.length + ' | refuted/dropped: ' + allRefuted.length + ' | low (not filed): ' + allLows.length)

// Compact payload for synthesis (avoid sending full scratchpads).
function compactSurvivor(s) {
  const f = s.finding
  const vsummary = (s.verdicts || []).map((v) => v.lens + '=' + v.verdict + '(' + v.correctedSeverity + ')').join(', ')
  return {
    domain: s.domain,
    id: f.id,
    title: f.title,
    severity: f.severity,
    category: f.category,
    files: f.files,
    observed: f.observed,
    trigger: f.trigger,
    impact: f.impact,
    proposedRegressionTest: f.proposedRegressionTest,
    proposedFix: f.proposedFix,
    verifierSummary: vsummary,
    verifierReasoning: (s.verdicts || []).map((v) => '[' + v.lens + '] ' + v.reasoning).join('\n'),
  }
}
const payload = {
  survivors: allSurvivors.map(compactSurvivor),
  refutedForAudit: allRefuted.map((s) => ({ domain: s.domain, title: s.finding.title, severity: s.finding.severity, verifierSummary: (s.verdicts || []).map((v) => v.lens + '=' + v.verdict).join(', '), reasons: (s.verdicts || []).map((v) => v.falsePositiveNote).filter(Boolean) })),
  lowsForAudit: allLows.map((l) => ({ domain: l.domain, title: l.finding.title, severity: l.finding.severity })),
  coverageGaps: coverageGaps,
}

// ---------- SYNTHESIZE ----------
phase('Synthesize')
const synthesis = await agent(synthesizePrompt(JSON.stringify(payload, null, 2)), {
  label: 'synthesize',
  phase: 'Synthesize',
  schema: SYNTHESIS_SCHEMA,
  effort: 'high',
})

return {
  runId: args.runId,
  auditDir: AUDIT,
  synthesis,
  rawCounts: {
    domains: clean.length,
    candidateFindings: clean.reduce((n, r) => n + r.survivors.length + r.refuted.length + r.lows.length, 0),
    survivors: allSurvivors.length,
    refuted: allRefuted.length,
    lows: allLows.length,
  },
}
