# Observability Discipline

Observability is part of the feature contract. A user or operator should be
able to tell what the system is doing, which runtime or worker is responsible,
what evidence exists, and what failed.

## Core Rule

If the system can make a decision, launch work, mutate code, run a sandbox, or
claim completion, that action should leave inspectable evidence.

For Open Agents this usually means some mix of:

1. user-visible status text,
2. structured workflow or chat data parts,
3. tool output metadata,
4. sandbox/profile/runtime attribution,
5. logs or run records,
6. screenshots/browser/service evidence,
7. final answer verification notes.

## Required Questions

Ask these before implementing non-trivial behavior:

1. What would a naive user need to see to believe this mode is active?
2. Which actor did the work: coordinator, subagent, managed runtime worker,
   sandbox service, workflow, or post-finish automation?
3. Which profile, sandbox, workflow run, deployment, or external service was
   used?
4. What is the current status while it runs?
5. What command, test, screenshot, log, or event proves it completed?
6. What failure mode is likely, and how will the UI or final answer surface it?
7. Which sensitive values must not be shown?

## Managed Runtime And Verified Build

Managed runtime and Verified Build features need stronger evidence than a label.
Use the [Managed Runtime Proof Standard](managed-runtime-proof-standard.md) for
managed-runtime issue acceptance criteria and completion gates.

Minimum signals:

1. selected mode and profile id/version,
2. sandbox or worker attribution,
3. setup/probe results for expected tools,
4. service URLs/log links when applicable,
5. browser check evidence when UI behavior is involved,
6. a final note naming what was verified and what was not,
7. tests proving the coordinator cannot bypass the intended worker path.

Do not treat a coordinator transcript as proof. Completion should be backed by
events, tool outputs, verification commands, screenshots, gates, or persisted
runtime state.

## Browser And UI Feedback

For local UI changes:

1. run the relevant automated test first,
2. open the exact local target with Agent Browser,
3. inspect the interactive snapshot,
4. exercise the changed path,
5. check console errors, page errors, and relevant network requests,
6. inspect local server logs when behavior is involved,
7. report the smoke result.

Agent Browser smoke is not a substitute for durable automated tests when a
behavior can regress.

## Production And Deploy Evidence

For deployment-impacting changes, record:

1. commit SHA,
2. deployment id or URL,
3. health endpoint or page smoke result,
4. migration status if schema changed,
5. rollback path,
6. any known gaps or unverified paths.

Never deploy uncommitted source unless it is an explicit break-glass emergency.
