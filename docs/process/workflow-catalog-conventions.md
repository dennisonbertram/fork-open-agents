# Workflow Catalog Conventions

This document defines the conventions for adding and maintaining entries in the
managed workflow catalog (`apps/web/lib/workflows/catalog.ts`). Follow these
rules before opening a PR that adds, modifies, or removes a catalog entry.

## Id Naming Convention

Workflow ids use **kebab-case** and describe the workflow purpose concisely.

Rules:

- lowercase letters, digits, and hyphens only
- no underscores, spaces, or uppercase letters
- must be unique within `DEFAULT_CATALOG`
- should be stable once published (changing an id is a breaking change for any
  client that stores or filters by id)

Examples: `verified-build`, `deep-research`, `runtime-profile-validation`,
`release-smoke`.

## Version Convention

Versions follow the semver-ish pattern `MAJOR.MINOR.PATCH` with an optional
pre-release suffix (`-alpha.1`, `-beta.2`, etc.).

Rules:

- new catalog entries start at `"0.1.0"`
- increment `MINOR` for non-breaking behavior additions
- increment `MAJOR` for breaking changes to inputs, outputs, or capabilities
- pre-release suffixes (e.g. `"1.0.0-beta.1"`) are valid for entries under active
  development

## Proof Level Mapping

Proof levels come from
[Managed Runtime Proof Standard](managed-runtime-proof-standard.md).
Choose the **lowest level that is sufficient** for the workflow's verification
requirements.

| Level | Meaning | When to use |
| --- | --- | --- |
| `level-1` | Local deterministic proof — deterministic tests and local records only | Research, synthesis, or document-retrieval workflows that produce local artifacts and need no live sandbox or deployment |
| `level-2` | Local or live sandbox proof — a real sandbox run exercises the workflow path | Workflows that require a live sandbox, tool probes, or service evidence but do not need production deployment proof |
| `level-3` | Production proof — deployed commit, runtime inspector, and production smoke | Workflows that verify, release, or smoke-test production deployments; any workflow whose correctness claim requires a deployed commit SHA |

## The `enabled` Flag and Disabled Conventions

The `enabled` field controls whether the catalog API surfaces the workflow as
runnable.

Rules:

- set `enabled: false` for any workflow whose execution runtime has not shipped
- set `enabled: true` only when the workflow is fully operational and tested
  end-to-end in the target environment
- **do not add a separate "disabled reason" field** — embed the reason in
  `description` so the catalog API can surface it to users without a schema
  change
- the description of a disabled entry must include a sentence that starts with
  "Not yet available:" followed by a plain-language reason

Example description for a disabled entry:

```
"Runs a post-deploy production smoke. Not yet available: the managed workflow
runtime that executes this workflow has not shipped."
```

## How To Add A New Catalog Entry

1. Choose an id (kebab-case, unique, stable).
2. Set `version: "0.1.0"` for a new entry.
3. Write a `description` that explains what the workflow does AND — if
   `enabled: false` — adds a "Not yet available: ..." sentence.
4. Choose a `proofLevel` from the table above. Document the rationale in your PR.
5. List `capabilities` as an array of kebab-case tags that describe what the
   workflow does (e.g. `"multi-agent-coordination"`, `"build-verification"`).
6. Set `enabled: false` until the runtime path is fully shipped and proven.
7. Wrap the entry object in `Object.freeze(...)` with `Object.freeze(...)` on the
   `capabilities` array, matching the pattern of the existing entries.
8. Add the entry to `DEFAULT_CATALOG`.
9. Run `bun test apps/web/lib/workflows/catalog.test.ts` — update the `length`
   assertion in `BT-ISSUE33-001` to match the new count and add an id to
   `EXPECTED_CATALOG_IDS`.
10. Run `bun --bun run ci` to confirm the full suite passes.

## Initial Workflow Table

| Id | Name | Version | Proof Level | Status | Disabled Reason |
| --- | --- | --- | --- | --- | --- |
| `verified-build` | Verified Build | 0.1.0 | level-3 | disabled | Managed workflow runtime has not shipped |
| `deep-research` | Deep Research | 0.1.0 | level-1 | disabled | Managed workflow runtime has not shipped |
| `runtime-profile-validation` | Runtime Profile Validation | 0.1.0 | level-2 | disabled | Managed workflow runtime has not shipped |
| `release-smoke` | Release Smoke | 0.1.0 | level-3 | disabled | Managed workflow runtime has not shipped |

### Proof Level Rationale

- **`verified-build` → level-3**: A verified build produces a go/no-go report
  tied to a deployed commit and requires production runtime inspector evidence.
  Correctness cannot be proven without a real deployment record.

- **`deep-research` → level-1**: Research workflows produce local artifacts
  (structured reports). Deterministic tests over inputs and outputs are
  sufficient; no live sandbox or deployed commit is needed.

- **`runtime-profile-validation` → level-2**: Profile validation requires a
  real sandbox run with setup/probe event records attributed to the sandbox.
  Local tests alone cannot substitute for live tool-probe evidence.

- **`release-smoke` → level-3**: A release smoke verifies a deployed production
  path. Like `verified-build`, it requires a deployed commit SHA and production
  smoke result — level-3 is the minimum sufficient level.
