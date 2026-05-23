# Managed Runtime Profiles

Managed runtime must become a user-configurable, observable execution system. It should not become "the Bun sandbox", "the Node sandbox", or any other hard-coded runtime assumption. Bun is the first concrete application install we need to prove the mechanism, but the product model is a versioned profile that declares its own setup script, probes, snapshots, ports, and safe environment policy.

## Problem Statement

The current managed runtime UX can look like a label on top of the ordinary top-level coding agent. A user can see a transcript full of direct file, glob, read, and bash operations and reasonably conclude that the coordinator is doing all the work itself. A real managed runtime must prove three things:

- Which runtime profile was selected.
- Which sandbox or sandboxes performed the work.
- Which setup, commands, services, and verification evidence came from those sandboxes.

It must also avoid pretending tools exist. A sandbox may not have Node, npm, Bun, Python, Chrome, apt, or any other tool. Every profile must declare and verify its own requirements.

## Near-Term Baseline

- Keep managed runtime opt-in.
- Keep the current direct/classic mode available.
- Treat Bun installation as a profile-specific compatibility fallback for the default web profile, not a global platform invariant.
- Show runtime mode before work starts.
- Keep sandbox controls visible while disabled, with user-facing explanations.
- Stream profile setup status into chat before the agent begins work.
- Tell the agent the active profile and verified tools in its environment details.
- Capture setup failures as first-class runtime evidence instead of letting the agent discover missing tools late.

## Concepts

### Runtime Mode

Runtime mode is the top-level user choice:

- `classic`: the current behavior.
- `managed_runtime`: execution is mediated by managed runtime profiles and sandbox observability.

Runtime mode is not itself a toolchain. It only decides how execution is orchestrated.

### Managed Runtime Profile

A profile is a versioned environment declaration. It should include:

- stable profile id
- version
- display name
- short user-facing description
- setup script path
- setup command
- verification probes
- expected tools
- optional tools
- default exposed ports
- base snapshot id, if available
- snapshot lineage
- safe environment variable policy
- redaction policy for logs and artifacts

Example profile:

```json
{
  "id": "web-bun-agent-browser",
  "version": "2026-05-23.2",
  "displayName": "Web app with Bun and browser checks",
  "expectedTools": ["bun", "agent-browser"],
  "optionalTools": ["node", "npm"],
  "defaultPorts": [3000, 5173, 4321, 8000],
  "setupScript": "packages/sandbox/profiles/web-bun-agent-browser/setup.sh"
}
```

Node and npm are optional in that example. They may be present and useful, but the profile must not assume them unless it installs and verifies them.

### Setup Script

The setup script is the durable interface for installing applications into a sandbox. It should be source-controlled, readable, and runnable in three contexts:

- profile validation job
- snapshot creation job
- per-session fallback when a matching snapshot is unavailable or stale

The current first script is:

```text
packages/sandbox/profiles/web-bun-agent-browser/setup.sh
```

This script installs Bun, `agent-browser`, browser OS dependencies, and the
browser binary that `agent-browser` needs for the default web profile. It is
deliberately profile-specific. Future profiles can install a different runtime
or no runtime at all.

`agent-browser` is currently installed as a Bun-managed package, then the profile
creates a stable shim to the package's native binary for the sandbox platform.
That keeps Node and npm as optional observations instead of global sandbox
assumptions.

### Snapshot

A snapshot is a cached filesystem state produced after setup and verification pass. Vercel Sandbox snapshots capture installed packages and filesystem state, then shut down the sandbox after snapshot creation. This is useful because long setup work can be paid once and reused for new sandboxes.

Snapshot rules:

- Snapshots are an optimization, not the source of truth.
- A profile must still have setup and verification probes.
- A session should record the profile id, profile version, and snapshot id used.
- Old snapshots should remain addressable long enough for replay and debugging.
- Snapshot creation should not write repository source into `/vercel/sandbox`; it should keep the image clone-ready.

### Runtime Instance

A runtime instance is one sandbox running a profile for one job or subtask. Managed runtime should support multiple concurrent runtime instances. The top-level coordinator may launch several sandboxes when it decomposes work.

Each runtime instance should have:

- sandbox id/name
- profile id/version
- source snapshot id
- status
- current activity
- assigned work item
- started/updated timestamps
- preview URLs
- logs
- verification evidence
- final result packet

## Installing Bun Now

The immediate way to add Bun is:

1. Create a sandbox from Vercel's standard runtime or from the current base snapshot.
2. Copy the profile setup script into the sandbox.
3. Run the setup script.
4. Run verification probes.
5. Create a snapshot.
6. Configure `VERCEL_SANDBOX_BASE_SNAPSHOT_ID` to the new snapshot id.
7. Keep the per-session profile setup as a fallback for missing/stale snapshots.

The local command path is:

```bash
bun run sandbox:snapshot-base -- \
  --from-standard-runtime \
  --managed-runtime-profile web-bun-agent-browser
```

The current snapshot builder supports:

- `--from <snapshot-id>` to start from an existing snapshot.
- `--from-standard-runtime` to start without a base snapshot.
- `--managed-runtime-profile <profile-id>` to run a profile setup script and probes.
- `--managed-runtime-defaults` as shorthand for the default web profile.
- repeated `--command` flags for extra setup or validation steps.

Live validation on May 23, 2026 created this first default-web-profile snapshot from the standard Vercel runtime:

```text
snap_usPQYPZAF795vUWf7mA7akjZy5Gn
```

Production and development Vercel env have been configured with:

```text
VERCEL_SANDBOX_BASE_SNAPSHOT_ID=snap_usPQYPZAF795vUWf7mA7akjZy5Gn
```

This is the first learning loop for adding applications. Once Bun works, the same profile mechanism should be able to add other tools such as Playwright browsers, Chrome, Python, uv, pnpm, ripgrep, language servers, database CLIs, or project-specific binaries.

## Profile Validation

Profile validation should run before a profile can become a default for new sessions.

Validation stages:

1. **Create**: start a clean sandbox from either standard runtime or a parent snapshot.
2. **Install**: write and run the profile setup script.
3. **Probe**: run required and optional verification commands.
4. **Smoke**: run profile-specific smoke checks.
5. **Snapshot**: create a reusable snapshot only if required checks pass.
6. **Record**: store profile id, version, parent snapshot, new snapshot, command summaries, and timestamps.
7. **Promote**: update the active profile pointer only after validation passes.

Required probes should fail the profile. Optional probes should be reported but should not block promotion.

## Assisted Setup

Long term, users should not have to know all setup commands upfront. The app can assist by inspecting:

- `package.json`
- lockfiles
- `.nvmrc`, `.node-version`, `.tool-versions`
- `bun.lock`, `bun.lockb`
- `pnpm-lock.yaml`
- `requirements.txt`, `pyproject.toml`, `uv.lock`
- `go.mod`
- `Cargo.toml`
- dev server scripts
- failed tool probes from previous attempts

The assistant should propose a setup script diff rather than silently mutating the environment. The user can approve it, run validation, then snapshot.

## Runtime Enforcement

The user needs evidence that managed runtime is actually being used. A label is not enough.

### Coordinator-Only Top-Level Agent

In managed runtime enforcement mode, the top-level model should become a coordinator. It should not receive direct mutation tools such as write, edit, or raw bash against the repository workspace.

Allowed coordinator actions:

- inspect high-level session state
- create runtime instances
- assign work to a runtime instance
- ask for status
- request evidence
- stop or retry a runtime instance
- summarize results for the user

Disallowed coordinator actions:

- direct file writes
- direct code edits
- direct project command execution
- direct dependency installation
- direct test execution

This prevents the coordinator from doing the work itself and then presenting it as managed runtime work.

Current enforcement slice:

- `@open-agents/agent` exposes a managed-runtime tool policy.
- In `managed_runtime` mode, the top-level agent receives only coordinator-safe tools: todo updates, task delegation, user questions, skills, and web fetch.
- Direct repository read/write/edit/search/bash tools are removed from the top-level agent in managed mode.
- Workflow setup passes runtime mode and managed runtime profile/sandbox attribution into the agent call.
- Delegated `task` workers emit managed-runtime attribution in their tool output so the UI can show that work is running through a managed runtime worker.

This is not the final multi-sandbox workcell system. It is the first enforceable coordinator boundary using the existing subagent worker path while the broader Verified Build contracts and worker model mature.

### Worker Runtime Agent

The worker runtime agent runs inside a managed sandbox. It can receive ordinary coding tools, but all tool calls must be attributed to a runtime instance.

Worker output should include a completion packet:

- changed files
- commands run
- services started
- verification results
- screenshots or browser evidence
- known failures
- runtime instance id
- profile id/version

### Tool Routing Evidence

Every visible tool call in the chat should show its execution scope:

- `Coordinator`
- `Sandbox web-bun-agent-browser@2026-05-23.2 / session_session-id`
- `Sandbox worker-2 / checks repair`

The current transcript style, where a managed turn still shows generic `Read`, `Glob`, and `Bash`, is not enough. Tool calls need a badge or grouping that says which runtime produced them.

## Multi-Sandbox Observability

Managed runtime should support more than one sandbox at a time. The UI should show a runtime activity panel or grouped chat events with:

- active sandbox count
- per-sandbox status
- profile id/version
- source snapshot id
- current task
- latest command
- setup progress
- service previews
- logs
- browser check status
- verification status
- last heartbeat

Statuses should be explicit:

- `queued`
- `creating`
- `installing-profile`
- `verifying-profile`
- `ready`
- `working`
- `running-service`
- `blocked`
- `failed`
- `hibernating`
- `hibernated`
- `stopped`

For naive users, this should read like:

```text
Managed runtime
2 sandboxes running

web-1: working on UI change
checks-1: running test suite

Profile: web-bun-agent-browser@2026-05-23.2
Tools verified: bun, agent-browser
Optional tools: node unavailable, npm unavailable
```

## Event Model

Managed runtime should emit structured events rather than only free-form chat text.

Candidate event types:

- `runtime.profile.selected`
- `runtime.sandbox.create.started`
- `runtime.sandbox.create.completed`
- `runtime.profile.setup.started`
- `runtime.profile.setup.output`
- `runtime.profile.setup.completed`
- `runtime.profile.verify.completed`
- `runtime.worker.started`
- `runtime.worker.tool.started`
- `runtime.worker.tool.completed`
- `runtime.service.started`
- `runtime.browser_check.completed`
- `runtime.worker.completed`
- `runtime.worker.failed`
- `runtime.sandbox.hibernated`

Events should be stored so later turns, support sessions, and future agents can inspect what happened.

## Environment Variables

Do not blindly inject secrets into sandboxes.

Variable categories:

- public config values
- non-secret build config
- short-lived scoped credentials
- repo-specific build secrets
- broker-only secrets that should never enter a sandbox

Initial safe policy:

- Default deny.
- Allowlist by profile and project.
- Redact values in chat, logs, and stored events.
- Show names and scopes, not values.
- Prefer brokered credentials for GitHub and deployment APIs.
- Prefer short-lived tokens where sandbox injection is necessary.

Example UI:

```text
Environment
Injected: NEXT_PUBLIC_API_BASE, FEATURE_FLAG_EXPERIMENTAL
Brokered: GitHub setup token
Blocked: VERCEL_TOKEN, OPENAI_API_KEY
```

## Data Model Direction

Likely tables or records:

- `managed_runtime_profiles`
- `managed_runtime_profile_versions`
- `managed_runtime_snapshots`
- `managed_runtime_instances`
- `managed_runtime_events`
- `managed_runtime_profile_validations`
- `managed_runtime_env_policies`

Sessions should record:

- selected runtime mode
- selected profile id
- selected profile version
- snapshot id used
- active runtime instance ids

## Implementation Phases

### Phase 1: Profile and Snapshot Foundation

- Add source-controlled setup scripts.
- Add profile metadata.
- Let snapshot creation start from standard runtime.
- Copy setup scripts into sandbox before running them.
- Run required and optional probes.
- Produce a new snapshot id.
- Document how to configure `VERCEL_SANDBOX_BASE_SNAPSHOT_ID`.

Exit gate: a new sandbox snapshot can be created from standard runtime with Bun installed and verified for the default web profile.

### Phase 2: User-Visible Profile Evidence

- Show selected profile id/version in the chat header.
- Show setup/probe events in chat.
- Show verified and missing tools.
- Include profile id/version in final answers when managed runtime was used.

Exit gate: a naive user can tell which runtime profile was used and whether required tools were verified.

### Phase 3: Coordinator Enforcement

- Add managed-runtime enforcement mode.
- Remove direct mutation tools from the top-level coordinator in managed mode.
- Pass managed runtime profile/sandbox attribution through the agent context.
- Surface delegated worker attribution in task output/UI metadata.
- Add coordinator tools for launching workers and querying runtime status.
- Attribute every worker tool call to a sandbox instance.

Exit gate: a managed runtime turn cannot modify files unless a worker sandbox does it.

### Phase 4: Multi-Sandbox Runtime Panel

- Persist runtime instances.
- Stream per-sandbox events.
- Add active sandbox count and status panel.
- Group chat transcript by sandbox.
- Add service/log/browser-check links per sandbox.

Exit gate: users can see how many sandboxes are running, what each is doing, and what evidence each produced.

### Phase 5: Assisted Profile Builder

- Detect project requirements.
- Propose setup script changes.
- Run validation.
- Create/preserve versioned snapshots.
- Promote profile versions.

Exit gate: a user can create or update a sandbox profile without hand-writing all setup commands.

## Open Questions

- Should profiles be global, per-user, per-team, per-repo, or all of the above?
- How long should old snapshots be retained?
- Should profile validation be synchronous in the UI or durable background workflow?
- How should multiple workers coordinate file ownership and merge results?
- Which secrets can be brokered instead of injected?
- How much raw setup output should be stored, and for how long?
- Should the default managed runtime be a web profile, or should users always choose during setup?

## Current Learning

- A managed-runtime label is insufficient. The UI must prove execution scope.
- Missing `bun` and `node` in a managed runtime session means profile setup and probes must happen before worker execution.
- Bun can be installed through a profile setup script, but that does not imply Bun should be a permanent platform assumption.
- Node and npm should not be assumed either. They are optional or required only when a specific profile declares them.
- The standard Vercel sandbox user is `vercel-sandbox`; `$HOME` is `/home/vercel-sandbox`, and `/vercel` is root-owned. Profile-installed shims should live under `$HOME/.open-agents/bin`, not `/vercel/.open-agents/bin`.
- Vercel Sandbox snapshots are the right mechanism to make installed applications available quickly, but per-session setup must remain as a fallback.
