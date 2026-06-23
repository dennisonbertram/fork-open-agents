# Audit scratchpad — Managed runtime profiles, workers & tool boundary

Domain: managed-runtime profiles, worker attribution, tool-boundary enforcement, profile drafts, observability, PATH/shim.

## Files read
- docs/agents/lessons-learned.md (full)

## Key lessons-learned items (managed runtime) — DO NOT re-report fixes already in place
- L83: managed runtime must not assume Node/npm/Bun/Python exist; toolchains belong to versioned runtime profiles with setup scripts + verification probes.
- L84: `command -v` not enough; profile setup must verify exec path, run CLI smoke, install browser deps.
- L86: "managed runtime" label is not proof; need sandbox/profile attribution; enforcement mode should remove direct mutation tools from top-level coordinator.
- L88: managed runtime enforcement must be a tool boundary, NOT prompt-only; remove direct read/write/edit/search/bash tools from top-level agent in managed mode; pass attribution into worker outputs.
- L90: Vercel sandboxes run as `vercel-sandbox`, `$HOME=/home/vercel-sandbox`; `/vercel` root-owned. Shims under `$HOME/.open-agents/bin`, that path MUST be in sandbox command PATH.
- L91: observability should persist setup/verification as structured command observations, NOT raw stdout/stderr; short redacted summaries, command ids, durations, exit codes, profile run id.
- L92: session-level runtime events should be shared ledger across workflow/profile/services/browser/harness.
- L94: package-manager selection for sandbox dev servers must probe PATH before launching; if none, emit blocked runtime event pointing back to managed profile setup.

## Candidate defects (work in progress)
(tracking below as I find them)

## Coverage gaps
(to fill at end)
