# Managed Runtime Proof Standard

Use this standard before opening, implementing, or closing managed-runtime work.
The goal is to make managed runtime trust inspectable instead of asking users to
believe a label or a model summary.

## Core Rule

A managed-runtime claim is proven only when a skeptical user or operator can
inspect evidence outside the assistant's prose and verify that the claimed
runtime path actually happened.

Proof is not:

1. a "Managed runtime" label in the UI,
2. the model saying it used managed runtime,
3. a transcript that merely shows tool calls,
4. a final answer claiming tests passed,
5. a screenshot without runtime attribution.

Proof is a linked evidence bundle whose records agree about mode, profile,
sandbox or worker, command evidence, service evidence, verification, and
limitations.

## Required Evidence Bundle

Every proof bundle should include these records or explicitly state why a record
is not applicable.

1. **Claim**: the concrete claim being made, for example "this run used managed
   runtime profile `web-bun-agent-browser@2026-05-23.2`."
2. **Provenance**: session id, chat id, workflow run id, profile run id,
   sandbox id or name, worker id when present, source SHA when deployment is
   involved, and timestamps.
3. **Enforcement**: evidence that the top-level coordinator could not bypass
   managed runtime and directly mutate code in managed mode.
4. **Environment preparation**: setup and probe records for required and
   optional tools, including status, duration, exit code, redacted summaries,
   profile id, profile version, and snapshot id when one was used.
5. **Attributed work**: changed files, commands, service launches, browser
   checks, logs, and tool outputs attributed to the managed worker or sandbox,
   not only to "the agent."
6. **Independent verification**: tests, command summaries, dev-server URL or
   service logs, browser screenshot/check evidence, production smoke, or another
   non-prose artifact.
7. **User visibility**: chat and inspector states that make the active mode,
   profile, sandbox or worker, current activity, pass/fail/blocked states, and
   verification outcome obvious to a naive user.
8. **Limitations**: what was not proven, what was skipped, and why. A blocked or
   partial proof is valid evidence only if the limitation is visible.
9. **Redaction**: evidence proves what happened without exposing secrets, raw
   tokens, private env values, or sensitive stdout/stderr.

## Proof Levels

Use the lowest level that is sufficient for the issue, but do not claim a higher
level without its required evidence.

### Level 1: Local Deterministic Proof

The behavior is proven by deterministic tests and local records.

Required evidence:

1. tests proving managed mode removes direct coordinator coding tools,
2. tests proving runtime mode and profile metadata reach the agent/workflow path,
3. tests proving setup/probe records are persisted or surfaced,
4. tests proving missing required tools produce a clear blocked event,
5. `git diff --check`,
6. the relevant targeted test command.

### Level 2: Local Or Live Sandbox Proof

A real sandbox run exercises the managed runtime path.

Required evidence:

1. all Level 1 evidence for the touched behavior,
2. sandbox id or name,
3. profile setup and probe event records,
4. command evidence attributed to the sandbox or worker,
5. service/dev-server evidence when the task involves a running app,
6. browser/screenshot evidence when UI behavior is involved,
7. final user-facing summary naming what passed, failed, or remained unproven.

### Level 3: Production Proof

The deployed app proves the full managed-runtime path for a real user-visible
run.

Required evidence:

1. all Level 2 evidence,
2. deployed commit SHA and deployment URL or id,
3. runtime inspector evidence visible in production,
4. production smoke result,
5. rollback or recovery note for deploy-impacting changes.

## Completion Gate

A managed-runtime run is not complete just because the assistant finished a
turn. It is complete only when the UI, persisted records, tool outputs, and
final answer all agree on:

1. selected runtime mode,
2. selected profile id and version,
3. sandbox or worker attribution,
4. setup/probe result,
5. commands or services run,
6. verification outcome,
7. known limitations.

If those surfaces disagree, the proof is incomplete and the issue should remain
open or explicitly record the gap.

## Issue Acceptance Criteria

Managed-runtime issues should include acceptance criteria in this shape:

```markdown
## Proof Level

- Target level:
- Why this level is sufficient:

## Required Evidence

- [ ] Claim named.
- [ ] Provenance captured.
- [ ] Coordinator enforcement covered.
- [ ] Profile setup/probe results captured.
- [ ] Work attributed to managed worker/sandbox.
- [ ] Independent verification captured.
- [ ] User-visible status/inspector feedback captured.
- [ ] Limitations surfaced.
- [ ] Secrets redacted.

## Behavior TDD

- [ ] User/operator path named.
- [ ] Behavior test file.
- [ ] Behavior RED command and expected reason.
- [ ] GREEN command.
- [ ] Adjacent suite command.
```

## Relationship To Runtime Profiles

Runtime profiles define environment requirements. They are not global platform
assumptions. A profile may require Bun, Node, Python, a browser tool, or no
language runtime at all, but the profile must install or verify what it needs.

Snapshots are startup optimizations. The source of truth remains the
source-controlled profile, setup script, probes, and recorded proof bundle.
