Summary: Plan a phased dev -> staging -> production release pipeline with a matching environment-variable safety model. The detailed epic plan is `docs/plans/dev-staging-production-env-secrets-epic.md`; the GitHub epic is https://github.com/vercel-labs/open-agents/issues/887.

Context: Open Agents currently has one CI workflow, Vercel deployment guidance, production env documentation, disabled Vercel Development env syncing to sandboxes, GitHub credential brokering via sandbox network policy, and recent runtime observability work. `/Users/dennison/develop/centaur` exists but is empty, so no Centar example was available to inspect. Current Vercel docs confirm custom environments, branch-matched env vars, target-specific deploys, and production promotion behavior.

System Impact: The pipeline and env-var design should not be separate features. Promotion gates, secret scopes, sandbox runtime profiles, migration safety, OAuth callbacks, DB/Redis isolation, and user-visible deployment evidence all become part of one release trust boundary.

Approach: Do not jump straight to a full release train. First add trusted evidence and secret boundaries: branch protection, deployment records, health/smoke checks, environment inventories, and a server-side secret broker that passes references and scoped grants instead of raw values. Then introduce dev and staging environments once CI, migrations, and sandbox env grants are observable and reversible.

Changes:
- `docs/plans/dev-staging-production-env-secrets-epic.md` - Epic plan covering pipeline stages, readiness gates, environment isolation, secret broker architecture, sandbox injection rules, observability, tests, and rollout phases.

Verification:
- Validate assumptions against current repo docs and code paths.
- Re-check Vercel custom environment and env-var behavior with current docs before implementation.
- Each future implementation slice should add deterministic tests first, then local/preview/staging smoke evidence.
