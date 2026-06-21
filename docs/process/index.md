# Process Index

This folder is the operating system for building Open Agents without relying on
chat history, local memory, or vibes.

Start here:

- [Local Development Setup](local-development.md) - `./init.sh` bootstrap for
  local checkouts, worktrees, sandboxes, and VMs.
- [Development Workflow](development-workflow.md) - day-to-day implementation
  loop for non-trivial changes.
- [Feature Ticket Format](feature-ticket-format.md) - standard issue shape for
  PR-sized work.
- [GitHub Build Process](github-build-process.md) - issue, branch, PR, CI, and
  deploy structure.
- [Agent Browser Preview Review](agent-browser-preview-review.md) - how to
  inspect Vercel Preview deployments before production.
- [Background Agents Live Proof](background-agents-live-proof.md) - hosted
  proof steps for triggered sandbox automation before rollout.
- [Agent Loops Smoke Checklist](agent-loops-smoke-checklist.md) - durable
  authenticated smoke checklist for the loops surface (create → configure →
  activate → run → watch live → retry); proof template for closing #331, #332,
  and #333.
- [Production Release Runbook](production-release-runbook.md) - merge,
  production smoke, and rollback procedure.
- [Behavior TDD](behavior-tdd.md) - behavior-first TDD for user and operator
  paths.
- [Regression Discipline](regression-discipline.md) - bug-to-regression rules.
- [API Contract Tests](api-contract-tests.md) - real-HTTP contract suite
  (`bun run test:contract`) for verifying the backend independently of the UI.
- [OpenAPI Contract & Typed Client](api-openapi-contract.md) - the generated
  `openapi.json` + typed client (`lib/api/client.ts`) the frontend consumes.
- [Observability Discipline](observability-discipline.md) - how work proves what
  happened to users and operators.
- [Diagnostic Bundles](diagnostic-bundles.md) - bounded, redacted session-chat
  exports for debugging runs without production shell access.
- [Chief of Staff Account Coordinator](../plans/chief-of-staff-account-coordinator.md)
  - backend-first account status and diagnosis API contract for future Chief of
  Staff UI/tooling.
- [Managed Runtime Proof Standard](managed-runtime-proof-standard.md) - the
  evidence bundle required before managed-runtime work can claim it is proven.
- [Isolated Worker Live Proof](isolated-worker-live-proof.md) - operator smoke
  for delegated isolated workspace evidence.
- [Formatting Gate](formatting-gate.md) - formatter and diff hygiene before
  handoff.
- [Workflow Catalog Conventions](workflow-catalog-conventions.md) - id naming,
  versioning, proof-level mapping, disabled-entry rules, and how to add catalog
  entries.
- [Pipeline Gates](pipeline-gates.md) - the machine-enforced layer (pre-push
  hook, CI build/guards jobs, migration-safety, test-touch, production smoke)
  under the prose process docs.

Supporting docs:

- [Architecture](../agents/architecture.md)
- [Code Style](../agents/code-style.md)
- [Lessons Learned](../agents/lessons-learned.md)
- [Managed Runtime Profiles](../plans/managed-runtime-profiles.md)
- [Chief of Staff Account Coordinator](../plans/chief-of-staff-account-coordinator.md)
- [Verified Build Roadmap](../plans/verified-build-roadmap.md)
