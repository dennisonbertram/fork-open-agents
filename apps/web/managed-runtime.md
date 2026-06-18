# Managed Runtime Audit Scratchpad

## Domain Scope
- Runtime profiles: setup/verification probes
- Worker attribution
- Managed-mode tool-boundary enforcement
- Profile drafts
- Observability (stdout vs redacted summaries)
- PATH/shim directory handling

## Files Read
- `docs/agents/lessons-learned.md` (56 managed-runtime/sandbox lessons)
- `lib/managed-runtime/code-editor-gate.ts`
- `lib/managed-runtime/profile-resolution.ts`
- `lib/dev/managed-runtime-demo.ts`
- `lib/db/managed-runtime-saved-profiles.ts`
- `lib/db/managed-runtime-profile-drafts.ts`
- `lib/observability/managed-runtime-profile-runs.ts`
- `lib/observability/managed-runtime-workers.ts`
- `lib/harness/redaction.ts`
- `lib/sandbox/runtime/service-logs.ts`
- `app/api/sessions/_lib/session-context.ts`
- `app/api/sessions/[sessionId]/managed-runtime/profile-drafts/route.ts`
- `app/api/sessions/[sessionId]/managed-runtime/profile-drafts/[draftId]/route.ts`
- `app/api/sessions/[sessionId]/managed-runtime/profile-drafts/[draftId]/test/route.ts`
- `app/api/sessions/[sessionId]/managed-runtime/profiles/route.ts`
- `app/api/sessions/[sessionId]/managed-runtime/profiles/[profileId]/route.ts`
- `app/api/sessions/[sessionId]/managed-runtime/profiles/[profileId]/test/route.ts`
- `app/api/settings/runtime-profiles/route.ts`
- `app/api/settings/runtime-profiles/[profileId]/route.ts`
- `packages/sandbox/managed-runtime-profiles.ts`
- `packages/sandbox/vercel/sandbox.ts` (DEFAULT_COMMAND_PATH, exec, getCommandEnv)
- `packages/agent/open-agent.ts` (MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES, tool policy)
- `packages/agent/tools/task.ts` (subagent delegation, managed runtime annotations)
- `packages/agent/subagents/registry.ts`
- `packages/agent/subagents/executor.ts` (subagent tool set)
- `app/workflows/chat.ts` (runtime mode resolution into agent)
- `app/workflows/chat-sandbox-runtime.ts` (ensureManagedRuntimeEnvironment, full flow)
- `app/workflows/workspace-startup-log.ts` (log redaction, command output logging)
- `app/sessions/.../managed-runtime-profile-approval-sync.ts`
- `app/sessions/.../managed-runtime-profile-manager.tsx`

## Assumptions About How The App Works

1. **Tool Boundary Enforcement**: When `runtimeMode === "managed_runtime"`, the coordinator agent gets only `MANAGED_RUNTIME_COORDINATOR_TOOL_NAMES` = `[todo_write, task, ask_user_question, setup_managed_runtime_profile, skill, web_fetch]`. Bash/read/write/edit/grep/glob are EXPLICITLY excluded from the coordinator. The `task` tool delegates work to subagents (executor, explorer, design) which DO have full tool access. This is intentional — the coordinator delegates, workers execute.

2. **Tool Policy**: `getRuntimeModeToolPolicy()` in `packages/agent/open-agent.ts:207-268` applies the tool restriction at the code level. External tools (Composio, GitHub) are appended if not in the native tool registry. Tool boundary is CODE-ENFORCED, not just prompt guidance.

3. **Worker Attribution**: The task tool `packages/agent/tools/task.ts:80-106` attaches managed runtime metadata (`profileId`, `profileVersion`, `profileDisplayName`, `profileRunId`, `sandboxName`) to worker outputs when in managed mode. `extractManagedRuntimeWorkersFromParts` in `managed-runtime-workers.ts` parses this from message parts. `summarizeManagedRuntimeDirectToolUse` SKIPS `tool-task` parts (line 316) to avoid false attribution.

4. **Redaction Chain**: 
   - `buildManagedRuntimeCommandObservation` -> `summarizeManagedRuntimeCommandOutput` -> `redactHarnessValue(redactSandboxLog(combined), "summary")` -> applies secret patterns, truncates to 2000 chars
   - Workspace startup log -> `getCommandOutputLogLines` (last 24 lines) -> `normalizeLogLine` (420 char limit + SECRET_PATTERNS)
   - Sandbox exec output is truncated to 50k chars at the sandbox level (`MAX_OUTPUT_LENGTH`)

5. **PATH**: `DEFAULT_COMMAND_PATH` in `packages/sandbox/vercel/sandbox.ts:30` includes `/home/vercel-sandbox/.open-agents/bin` and `~/.bun/bin` for all users. Shims installed by profile setup are on PATH for subsequent commands.

6. **Auth/Ownership**: All managed runtime routes use `requireAuthenticatedUser()` + `requireOwnedSession()` or `requireOwnedSessionChat()` or `requireOwnedSessionWithSandboxGuard()`. No missing ownership checks found.

7. **Profile Setup Flow**: `ensureManagedRuntimeEnvironment` in `chat-sandbox-runtime.ts` runs setup commands, then verification commands, persisting results to `managedRuntimeProfileRuns` and emitting session events.

## Candidate Defects Considered

### Rejected (already addressed in code)

1. **"Tool boundary only as prompt guidance"** — REJECTED. `getRuntimeModeToolPolicy` physically removes bash/read/write/edit/grep/glob from coordinator tool set.
2. **"PATH not including shim dir"** — REJECTED. `DEFAULT_COMMAND_PATH` includes `/home/vercel-sandbox/.open-agents/bin`.
3. **"False coordinator-vs-worker attribution"** — REJECTED. `summarizeManagedRuntimeDirectToolUse` skips `tool-task` parts.
4. **"Assuming toolchain exists"** — REJECTED. Bun is scoped to default web profile only; profile explicitly installs tools.
5. **"Observability persisting raw stdout"** — REJECTED. Both DB path (summarizeManagedRuntimeCommandOutput) and realtime path (workspace startup log) apply redaction. DB gets redacted+truncated to 2000; startup log gets last 24 lines redacted to 420 chars each.

### Accepted (real defects)

See findings below.

## Real Defects Found

### Finding 1: ManagedRuntimeProfileRun leaked as "running" when optional setup command fails
**Files**: `app/workflows/chat-sandbox-runtime.ts:476`
**Trigger**: User creates a custom profile with an optional (`required: false`) setup command that fails.
**Mechanism**: At line 465-476, when a non-required setup command fails, the function returns `{ notes, profileRunId }` without calling `finishManagedRuntimeProfileRun()`. The profile run record stays in "running" status forever.
**Severity**: medium (data-integrity: orphaned run record; visibility: profile run status misleading)
**Confidence**: medium — the default profile has NO optional setup commands, so this requires a custom profile. But the code path is clear.

### Finding 2: Profile setup/verification re-runs on every chat turn instead of only on fresh sandbox provision
**Files**: `app/workflows/chat-sandbox-runtime.ts:842-854`
**Trigger**: Any managed_runtime session with more than one chat turn.
**Mechanism**: `ensureManagedRuntimeEnvironment()` is called unconditionally when `runtimeMode === "managed_runtime"`, even when the sandbox is being RESUMED (not freshly created). Compare with skill installation which IS gated on `didSetupWorkspace` (line 817-825). This causes:
  - Full profile setup/verification on EVERY chat turn
  - New `managedRuntimeProfileRun` DB row for every message (polluting observability)
  - Session events emitted for each setup/verification step on every message
  - `INSTALL_AGENT_BROWSER_COMMAND` (line 51-72 of managed-runtime-profiles.ts) unconditionally removes and reinstalls agent-browser each time
**Fix**: Gate on `didSetupWorkspace`, like skills do: `session.runtimeMode === "managed_runtime" && didSetupWorkspace`.
**Severity**: medium (performance — tens of seconds per chat turn for agent-browser reinstall; observability — misleading profile run history)
**Confidence**: high
