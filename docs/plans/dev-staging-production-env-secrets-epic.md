# Epic: Trusted Dev -> Staging -> Production Pipeline And Sandbox Secret Broker

Prepared: 2026-05-23
Status: planning, not ready for implementation
GitHub issue: https://github.com/dennisonbertram/fork-open-agents/issues/1

## Executive Summary

Open Agents should eventually have a trusted dev -> staging -> production release flow. We should not implement the full pipeline yet because the release gates and secret boundaries that would make the pipeline trustworthy are not mature enough.

The goal is not "add a few CI jobs." The goal is a release system where a naive user, operator, or future agent can answer:

- what source SHA is running in each environment?
- which checks, migrations, and smoke tests passed before promotion?
- which secrets exist in each environment without exposing their values?
- which secrets, if any, were granted to a sandbox, service, worker, browser check, or deployment?
- what can be rolled back, and what cannot?

This epic combines deployment promotion and environment-variable handling because they are the same trust boundary. A production release is not trustworthy if source control is gated but production secrets, database state, OAuth callbacks, sandbox snapshots, and provider tokens are unmanaged.

## Why Not Build The Whole Pipeline Now?

We are not blocked by Vercel or GitHub mechanics. We are blocked by trust primitives.

Building the visible pipeline first would likely produce a false sense of safety:

1. **Environment isolation is not proven.** Dev, staging, and production only mean something if databases, Redis/KV, OAuth apps, GitHub Apps, harness tenants, Vercel projects/custom environments, and sandbox profiles are actually separated.
2. **Secret handling is unresolved.** Without a secret broker, the natural shortcut is to copy env vars around or write `.env.local` into sandboxes. That is the wrong default.
3. **Deployment evidence is not first-class.** A pipeline should leave proof: SHA, deploy URL, migration status, smoke result, runtime profile result, and rollback pointer.
4. **Migrations need a promotion policy.** Today migrations run during build. A staged pipeline needs rules for schema rollout, failure handling, and rollback expectations.
5. **Vercel promotion is source-SHA promotion, not necessarily same-artifact promotion.** Vercel promotion can rebuild with production env vars. That can be acceptable, but it must be represented honestly in release evidence.
6. **Operational ownership is still forming.** Branch rules, approval rules, staging criteria, and deploy authority should not be locked before the project has enough process maturity.

The recommendation is to build a **shadow pipeline** first: record evidence, classify secrets, run health/smoke checks, and prove isolation without hard-blocking normal development. Once the evidence is reliable, turn it into enforcement.

## Scope

### In Scope

- Release-stage model: local, PR preview, dev, staging, production.
- Environment inventory and classification.
- Secret broker design for agent and sandbox use.
- Deployment evidence records.
- Health and smoke checks.
- Migration safety model.
- Runtime/sandbox observability for environment and secret grants.
- GitHub issue breakdown for future implementation.

### Out Of Scope For Now

- Enforcing branch protection immediately.
- Creating Vercel projects or custom environments now.
- Moving production deployments today.
- Injecting real secrets into sandboxes.
- Building a general-purpose secret manager.
- Replacing Vercel env vars before there is evidence we need to.
- Implementing artifact-level deployment promotion.

## Current Context

Current repo facts:

- CI currently runs formatting, typecheck, isolated tests, and migration checks.
- Deployment docs describe a Vercel app rooted at `apps/web`.
- Env vars are documented in `apps/web/.env.example`.
- Vercel project env helpers can list and serialize Development env vars.
- Direct Vercel Development env sync to sandbox is currently disabled/commented out.
- The sandbox abstraction supports environment variables, and Vercel command execution can inject them into commands.
- GitHub setup credentials are already brokered temporarily through sandbox network policy, then cleared.
- Agent tools require approval for `.env` reads.
- Shared pages redact `.env` content.
- Runtime Inspector can now show workflow, profile, service, browser, and session event evidence.

The user mentioned `develop/centar` as an example. I checked `/Users/dennison/develop/centaur`; it exists but is empty. I could not inspect a concrete Centar pattern in the local filesystem.

## External Platform Assumptions

Current Vercel documentation confirms:

- project env vars can target `development`, `preview`, `production`, git branches, and custom environment IDs;
- custom environments can be branch-matched;
- `vercel deploy --target=<environment>` can target a custom environment;
- preview deployments can be promoted to production;
- production promotion rebuilds with production environment variables, so source SHA continuity is possible, but same-artifact continuity is not automatic.

Before implementation, re-check Vercel docs because deployment and environment APIs change.

## Target Future State

The future release path should feel like:

```text
feature branch
  -> PR preview with automated checks and smoke evidence
  -> dev integration environment
  -> staging release candidate with production-like services
  -> production promotion with approval and rollback evidence
```

Every stage should be queryable:

```text
environment -> deployment -> source SHA -> migration state -> smoke result -> secret inventory -> runtime grants -> rollback target
```

## Environment Tiers

| Tier | Purpose | Suggested Shape | Data | Secrets | Promotion Role |
| --- | --- | --- | --- | --- | --- |
| Local | Developer work | `.env.local`, local services | local/dev-only | developer-owned | none |
| PR Preview | Branch review | Vercel Preview | branch DB if available | preview-safe only | verifies isolated branch |
| Dev | Integration | Vercel custom env or separate project | dev DB/Redis | dev-only | absorbs frequent changes |
| Staging | Release candidate | custom env or separate project | staging DB/Redis | staging-only | proves release readiness |
| Production | Customer-facing | Vercel Production | prod DB/Redis | prod-only | final release |

Use separate Vercel projects instead of custom environments when provider integrations cannot be safely isolated in one project. This matters for OAuth callbacks, GitHub App webhooks, AI Gateway/OIDC assumptions, Redis/KV stores, Neon branches, harness tenants, and sandbox base snapshots.

## Branch Model

Do not enforce this immediately. Treat it as the target once the trust primitives exist.

```text
feature/* -> PR
develop   -> integration branch
staging   -> release-candidate branch
main      -> production branch
```

Alternative if the team wants fewer long-lived branches:

```text
feature/* -> PR into develop
develop   -> dev auto-deploy
tag/release/* or promoted deployment -> staging/production
```

Decision criteria:

- Choose branches if humans need visible, persistent stage ownership.
- Choose promotion records if the team wants fewer merge trains and stronger deploy metadata.

## Release Evidence Model

Each deployable stage should create a release evidence packet:

- environment name;
- source SHA;
- branch or PR;
- deployment provider and deployment ID;
- deployment URL;
- migration status;
- health status;
- smoke status;
- secret inventory status;
- sandbox profile status, if relevant;
- approval actor, if relevant;
- rollback target;
- timestamps;
- links to logs and GitHub checks.

The evidence packet should be visible in GitHub and in an admin/deployment inspector.

## Promotion Gates

### PR Preview Gate

Purpose: prove a branch is safe enough to review.

Required evidence:

- CI green;
- migration check green;
- changed behavior has targeted tests;
- preview URL captured;
- health route passes;
- no secret exposure regression;
- deployment environment identified as preview.

### Dev Gate

Purpose: prove work integrates with shared dev services.

Required evidence:

- dev deployment linked to source SHA;
- dev database reachable;
- dev Redis/KV reachable;
- auth config present;
- sandbox creation smoke passes;
- managed runtime profile evidence exists for relevant changes.

### Staging Gate

Purpose: prove production-like readiness.

Required evidence:

- staging deployment linked to source SHA;
- staging database and Redis/KV are isolated from production;
- staging OAuth/GitHub App/webhook config is isolated from production;
- smoke passes: sign in, GitHub install/sync, repo-backed session, sandbox start, managed runtime, dev server, browser check;
- migration status recorded;
- secret inventory complete;
- rollback target recorded.

### Production Gate

Purpose: release intentionally.

Required evidence:

- approved source SHA;
- CI green for SHA;
- staging gate green for SHA;
- production env inventory complete;
- migration risk reviewed;
- deploy URL and health check recorded;
- rollback command or previous deployment recorded;
- deploy actor and approval actor recorded.

## Environment Variable Philosophy

Raw secrets should be treated as toxic data.

The system should expose:

- key names;
- classification;
- environment;
- source provider;
- presence/absence;
- grant state;
- expiration;
- audit events.

The system should not expose:

- decrypted values;
- bearer tokens;
- provider private keys;
- `.env.local` contents;
- secret values in command stdout/stderr;
- secret values in chat, shared pages, screenshots, browser artifacts, or session events.

## Secret Classes

| Class | Examples | Agent Visibility | Sandbox Visibility | Default |
| --- | --- | --- | --- | --- |
| Platform runtime | `POSTGRES_URL`, `BETTER_AUTH_SECRET`, GitHub App private key | hidden | never | server-only |
| Provider broker | GitHub install token, Vercel token | hidden | brokered only | temporary network or API grant |
| Public config | public URLs, non-secret flags | visible if classified public | allowed | visible |
| Test credentials | staging test user, test-only token | key/status only | explicit scoped grant | denied |
| User project secrets | API keys, third-party tokens | key/status only | explicit scoped grant | denied |
| Sandbox profile config | package manager/profile settings | visible | allowed if non-secret | profile-defined |

## Secret Broker Concept

Introduce a server-side broker between stored secrets and sandboxes/agents.

The broker should answer:

- who is requesting access?
- for which environment?
- for which session, sandbox, service, browser check, workflow, or command?
- for what purpose?
- which keys are requested?
- is the request allowed?
- how long should the grant last?
- how will use be audited?

The broker should return grants and execution plans, not raw values, except to the final server-side execution boundary that invokes the command or provider API.

## Grant Types

### Per-Command Env Grant

Use for one command:

```text
grant -> resolve values server-side -> call sandbox.exec with env -> redact output -> expire grant
```

Best for:

- integration tests;
- one-off commands;
- build steps that need staging-safe credentials.

### Managed Service Env Grant

Use for a long-running dev server:

```text
grant -> start service with env -> record service id -> revoke on stop/timeout/archive
```

Best for:

- `next dev`/`vite` service needing a test API key;
- previewing user apps against staging services.

### Browser Check Grant

Use for browser automation:

```text
grant -> issue cookie/header/test credential -> run browser check -> revoke
```

Best for:

- authenticated smoke tests;
- test-only app flows.

### Network/Header Broker Grant

Use provider-specific network policy instead of process env:

```text
grant -> add host-scoped header transform -> perform provider operation -> clear transform
```

Best for:

- GitHub clone/fetch/setup;
- Vercel API operations;
- provider APIs where a host-scoped header is narrower than environment variables.

### File Env Grant

Highest-risk path.

Only allow generated `.env.local` when:

- every key is classified sandbox-safe;
- user explicitly approves;
- file path is recorded;
- TTL/revocation behavior is clear;
- Runtime Inspector shows the grant;
- redaction is tested;
- shared pages never expose file contents.

Default should remain "no env file."

## Agent Contract

The agent should receive statements like:

```text
Environment profile: staging
Secret keys available by name: STRIPE_TEST_KEY, CUSTOMER_IO_TEST_KEY
Raw values are not available to you.
Ask for an env grant if a command or managed service needs one.
Do not read .env files as evidence.
```

The agent should not receive:

- raw secret values;
- decrypted Vercel env vars;
- long-lived provider tokens;
- instructions to write secret files.

## User Experience

A Runtime Inspector or Deployment Inspector should show:

- current environment profile;
- required keys: present/missing/denied/granted/expired;
- grant purpose;
- grant target;
- grant TTL;
- last use;
- revocation status;
- redaction status;
- blocked secret requests;
- release evidence for current deployment.

A naive user should be able to understand:

- "the system did not give my production API key to the sandbox";
- "this staging service got a temporary test key for this dev server";
- "this production deploy used SHA X and passed smoke Y";
- "rollback is deployment Z."

## Data Model Sketch

Do not implement until the schema is reviewed. Likely records:

### `environment_profiles`

- id;
- name: local, preview, dev, staging, production;
- provider kind;
- provider project/environment id;
- description;
- status;
- createdAt / updatedAt.

### `environment_variable_bindings`

- id;
- environmentProfileId;
- key;
- classification;
- source provider;
- source ref/id;
- required/optional;
- allowed targets;
- lastVerifiedAt;
- status.

No decrypted values.

### `sandbox_env_grants`

- id;
- sessionId;
- sandboxName;
- environmentProfileId;
- requestedBy actor;
- target type: command/service/browser/workflow;
- target id;
- keys;
- purpose;
- status;
- expiresAt;
- revokedAt.

No decrypted values.

### `secret_audit_events`

- id;
- grantId;
- sessionId;
- actor;
- event name;
- status;
- redacted metadata;
- createdAt.

### `deployment_runs`

- id;
- environmentProfileId;
- gitSha;
- branch;
- provider deployment id;
- deployment URL;
- status;
- migration status;
- health status;
- smoke status;
- secret inventory status;
- approval status;
- rollback deployment id;
- startedAt / finishedAt.

## Health And Smoke Checks

Health should test system readiness without leaking secret values:

- app booted;
- database reachable;
- migrations current;
- Redis/KV reachable when required;
- auth provider config present;
- GitHub App config present;
- AI Gateway/provider config present;
- sandbox config present;
- harness config present when enabled.

Smoke should test behavior:

- sign in path works in the target environment;
- GitHub App install/sync works;
- repo-backed session can start;
- sandbox can boot;
- managed runtime profile can prepare;
- dev server can start;
- browser check can reach preview URL;
- a trivial agent run leaves observable evidence.

## Migration Strategy

Before enforcing staging/production gates, define:

- which migrations are backward compatible;
- what happens if build-time migration fails;
- whether staging migrates first;
- whether production migration is automatic or approval-gated;
- how to recover from partially applied migrations;
- which migrations require manual rollout notes.

The deployment evidence packet should record migration status.

## Rollback Strategy

Rollback is not a single button if migrations changed schema.

Each production release should record:

- previous deployment id;
- previous source SHA;
- whether migration is backward compatible;
- rollback command;
- data recovery notes if needed;
- owner/approver.

For early phases, "rollback to previous Vercel deployment" is acceptable only for schema-compatible releases.

## Security Requirements

- No raw secret values in logs, session events, workflow data, browser artifacts, screenshots, shared pages, or assistant messages.
- No default sandbox env sync.
- No direct provider tokens in Git remotes.
- No permanent sandbox network policy transforms.
- No grant without actor, purpose, target, TTL, and audit trail.
- No production secrets in preview/dev/staging unless explicitly classified as safe.
- No production sandbox access to user project secrets without explicit approval.

## Observability Requirements

Every release and grant should leave evidence:

- who/what requested it;
- what environment it applied to;
- what was granted by key name;
- what was denied;
- which command/service/browser/deployment used it;
- when it expired or was revoked;
- whether redaction passed.

This should be surfaced in UI and durable records, not only in chat.

## Phased Roadmap

### Phase 0: Inventory And Policy

Goal: classify what exists before moving it.

Build later:

- environment inventory;
- secret classification policy;
- docs for required envs by environment;
- tests proving sandbox env sync remains disabled.

Exit gate:

- every required env key is classified;
- no raw sandbox env sync exists;
- CI green.

### Phase 1: Deployment Evidence

Goal: make current deploys inspectable without changing deploy flow.

Build later:

- deployment evidence packet;
- health endpoint;
- smoke script;
- admin/deployment inspector;
- GitHub issue/PR template additions for deploy evidence.

Exit gate:

- every deploy can report SHA, URL, health, migration status, and rollback target.

### Phase 2: Secret Broker V0

Goal: introduce scoped grants with no raw value exposure.

Build later:

- policy engine;
- fake secret provider for tests;
- grant records;
- audit events;
- redaction tests.

Exit gate:

- UI/agent can see key status without values;
- denied grants are visible;
- no decrypted value is persisted.

### Phase 3: Sandbox Grant Integration

Goal: allow useful sandbox work safely.

Build later:

- per-command env grants;
- managed service env grants;
- browser-check grants;
- network/header broker grants;
- Runtime Inspector grant evidence.

Exit gate:

- a staging-safe key can be granted to one service/command;
- grant expiration and revocation are tested;
- command output redaction catches injected values.

### Phase 4: Dev Environment

Goal: create a durable integration environment.

Build later:

- dev Vercel custom env or project;
- dev DB/Redis/OAuth/GitHub App config;
- dev deploy workflow;
- dev smoke.

Exit gate:

- dev deployment is isolated and observable.

### Phase 5: Staging Environment

Goal: create production-like release candidate flow.

Build later:

- staging Vercel custom env or project;
- staging service isolation;
- staging smoke;
- staging approval checklist.

Exit gate:

- staging proves a release candidate without touching prod resources.

### Phase 6: Production Promotion

Goal: deliberate production release with evidence and rollback.

Build later:

- production promotion runbook or workflow;
- approval gate;
- production health and smoke;
- rollback record.

Exit gate:

- production deploy requires approved SHA, green CI, dev/staging evidence, env inventory, and rollback pointer.

### Phase 7: Enforcement

Goal: make the trusted path mandatory.

Build later:

- branch protection;
- required checks;
- required deployment evidence;
- required secret inventory;
- protected production promotion.

Exit gate:

- direct production changes are blocked unless break-glass is explicitly used and audited.

## Suggested GitHub Issue Breakdown

When ready, create issue-sized slices from this epic:

1. Inventory required env vars and classify by environment.
2. Add health endpoint that checks dependencies without leaking values.
3. Add deployment evidence record and admin/read-only view.
4. Add smoke script for current production deploy.
5. Design and test secret classification policy.
6. Build Secret Broker V0 with fake provider and audit events.
7. Add per-command sandbox env grants.
8. Add managed service env grants.
9. Add browser-check env grants.
10. Add Runtime Inspector section for environment profile and grants.
11. Create dev environment and deploy workflow.
12. Create staging environment and smoke workflow.
13. Add migration safety policy and evidence.
14. Add production promotion runbook/workflow.
15. Enable branch protection and required checks.

Each issue should include:

- behavior protected;
- non-goals;
- first failing test;
- observability evidence;
- deploy/migration risk;
- rollback notes.

## Open Decisions

- Separate Vercel projects or custom environments?
- `main` is the production branch; `develop` is the integration/dev branch.
- Should production promotion use Vercel promote, `vercel deploy --prod`, or Git-backed production deploy?
- Should the long-term secret store be Vercel env vars, a separate secret manager, or a hybrid?
- How does user approval work for project secrets?
- Are managed runtime workers allowed different grant scopes than the top-level coordinator?
- Should preview deployments ever receive user project secrets?
- Which smoke tests are allowed to use real external providers?

## Readiness Checklist Before Implementation

Start implementation only when:

- the team agrees on branch/promotion semantics;
- every required env var is classified;
- staging/prod resource isolation is decided;
- the first broker provider is selected;
- migration policy is documented;
- the deployment evidence packet shape is accepted;
- at least one owner is assigned for release approval and break-glass.

## Near-Term Recommendation

Do not implement the full pipeline yet.

Next best step:

1. Keep this epic open in GitHub.
2. Use it as the parent for future issue slices.
3. Implement Phase 0 and Phase 1 when the team wants more release confidence.
4. Implement Secret Broker V0 before any sandbox env syncing.
5. Only then build dev/staging/production enforcement.
