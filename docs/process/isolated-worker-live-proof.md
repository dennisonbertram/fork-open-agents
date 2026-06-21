# Isolated Worker Live Proof

Use this smoke to prove an isolated delegated worker actually ran in a separate
workspace, wrote a harmless marker, persisted lifecycle evidence, and cleaned up.
It follows the [Managed Runtime Proof Standard](managed-runtime-proof-standard.md)
for Level 2 local or live sandbox proof.

## Protected Operator Path

An operator can run a proof command, paste the generated evidence into a pull
request or issue, and tell whether the result is:

1. `passed` because parent/child workspace separation, child tool execution,
   lifecycle persistence, marker isolation, and cleanup all passed;
2. `blocked` because live prerequisites are missing or source linkage is
   incomplete; or
3. `failed` because the evidence disproves isolation.

The proof output redacts full private filesystem paths and prints only path
names such as the final workspace directory.

## Command

```bash
bun run proof:isolated-worker -- --format markdown
```

The default command is intentionally allowed to return `blocked`. A blocked
result is evidence that the live backend is not configured; it is not evidence
that isolated workspaces are proven.

To run a live proof after a real isolated workspace provisioner is wired into
the sandbox backend:

```bash
ISOLATED_WORKER_LIVE_PROOF_ENABLED=1 bun run proof:isolated-worker -- --live --format markdown
```

For machine-readable output:

```bash
bun run proof:isolated-worker -- --format json
```

## Evidence Contract

The proof requires these records:

- parent workspace id, optional source ref, optional source commit, and marker
  absence before integration;
- child worker id, child workspace id, optional source ref, optional source
  commit, marker path, marker write result, and child tool execution result;
- persisted delegated worker run id, terminal status, lifecycle states, and
  evidence refs;
- cleanup status and detail;
- explicit limitations.

The validator fails evidence when the parent and child workspace ids match, when
the marker appears in the parent before integration, when the child tool run
fails, or when persisted lifecycle does not reach `completed`.

It returns `blocked` when source linkage or cleanup is incomplete, so operators
can still attach a useful partial proof without overstating it.

## Validating A Captured Evidence Fixture

Use `--evidence-json` when a live runner captures evidence through another
surface and you want this command to validate and format it:

```bash
bun run proof:isolated-worker -- --evidence-json "$EVIDENCE_JSON" --format markdown
```

Do not include tokens, raw environment values, or full private filesystem paths
inside the evidence JSON. The formatter redacts workspace paths in rendered
check evidence, but the source JSON should be safe to attach before it reaches
the formatter.
