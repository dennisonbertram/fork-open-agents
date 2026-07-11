# AgentDefinitionV1 additive contract

GitHub issue: [#936](https://github.com/dennisonbertram/fork-open-agents/issues/936)
Parent product-reset epic: [#931](https://github.com/dennisonbertram/fork-open-agents/issues/931)

`AgentDefinitionV1` is a reusable, validated execution definition. It is not a
new persistence model and does not make the role-scoped `agents` table the
canonical Automation store. The initial adapters are pure characterization
boundaries; no executor consumes them yet.

## Boundary

The definition contains source-qualified identity, instructions,
model/inference selection, skill references, built-in and Composio tool policy,
native GitHub/tool-authoring policy, effective permissions, runtime profile,
verification command, and output schema.

The adapter result deliberately returns source policy beside—not inside—the
definition:

- `automationBinding`: chat role/origin, repository, enabled state,
  trigger/schedule configuration, run budget, or loop editor metadata.
- `publishingPolicy`: GitHub publishing actions, write scope, and CI-before-merge
  policy.
- `workspacePolicy`: reserved and `null` in V1. Persistent Session workspaces
  and disposable unattended sandboxes are not merged by this contract.

Credentials are bindings, not reusable definition fields. The only current
credential reference, a resolved chat agent's Composio profile ID, remains in
`automationBinding`. Raw tokens, webhook secret hashes, cookies, repository and
branch identity, trigger payloads, schedules, sandbox names, and workspace
lifecycle data cannot pass the strict definition schema.

## Source field classification

### Resolved chat agent

| Source fields | Destination |
| --- | --- |
| `agentId` | Definition identity. A synthetic fallback uses `fallback` plus the role instead. |
| `modelId`, `inferenceProfileId`, `instructions`, `skillRefs` | Definition cognition. |
| `builtinToolNames`, `composioToolkitSlugs`, `toolAuthoringEnabled`, `githubToolsEnabled` | Definition tool policy. |
| `managedRuntimeProfileId` | Definition runtime reference. |
| `role`, `fromDbRow` | Automation binding and resolution provenance. |
| `composioProfileId` | Automation credential binding, never the reusable definition. |

### Background agent / client-safe spec

| Source fields | Destination |
| --- | --- |
| `id`, `name`, `description`, `instructions`, `modelId` | Definition identity, metadata, and cognition. |
| `builtinToolNames`, `composioToolkitSlugs`, `permissions`, `checkCommand` | Definition tools, permissions, and verification. |
| `status`, `repoOwner`, `repoName`, `triggers`, `runBudgetPerTarget` | Automation binding. |
| `githubActions`, `writeScope`, `requireCiGreenForMerge` | Publishing policy. |

Trigger adapters copy only the client-safe trigger shape. A structurally wider
database object cannot smuggle `webhookSecretHash` or other unknown fields into
either the definition or the returned binding. The allowlist includes the
`mergedOnly` boolean because it is an execution guard: dropping either `true`
or `false` would change which pull-request events the Automation may handle.

### Frozen loop agent step

| Source fields | Destination |
| --- | --- |
| `loopId`, `node.id`, `node.kind`, `node.label` | Definition identity and metadata. |
| `node.instructions`, `node.builtinToolNames`, `node.composioToolkitSlugs` | Definition instructions and tool policy. |
| `node.outputSchema`, `node.checkCommand` | Definition output and verification. |
| `node.permissions`, loop permissions | Effective definition permissions. A non-empty step grant overrides the loop grant, matching the current executor. |
| `node.position`, effective permission source | Automation binding/editor metadata. |

## Compatibility and stop conditions

- The V1 schema is strict and accepts only `version: 1`; future versions fail
  with the safe `agent_definition_invalid` kind until explicitly supported.
- Source-qualified IDs use length-prefixed parts, so equal IDs across source
  kinds and ambiguous loop/node delimiters cannot collide.
- Adding a source field requires updating its compile-time classification and
  contract test.
- Do not wire these adapters into an executor until source behavior is
  separately characterized.
- Do not add repository, trigger, publishing, concurrency, credential, or
  workspace policy to the reusable definition to make a downstream UI easier.
- Any canonical Automation table or migration remains a later measured spike.
