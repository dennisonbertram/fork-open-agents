## Summary

Why this change exists:

-

What changed:

-

Base branch:

- [ ] Feature/integration PR targets `develop`
- [ ] Production release/hotfix PR targets `main`

## Scope

In scope:

-

Out of scope:

-

Reviewer guide:

- Start with:
- Mechanical/low-risk files:
- Highest-risk behavior or edge cases:

## Product / UX

- Entry point:
- User-visible behavior:
- States covered:
- Accessibility/usability notes:
- Browser evidence or blocker:

## Integration

- Routes/components/API surfaces:
- Agent/sandbox/workflow surfaces:
- Data/events/background jobs:
- External services/config:
- Observability:
- Backward compatibility:
- New logs/events/status visible to users or operators:
- Compatibility with existing data/runs/sessions:

## Test Evidence

- [ ] Smallest behavior/contract/regression test observed red first, if behavior changed
- [ ] Behavior/integration proof observed red before implementation, if applicable
- [ ] Red test commit:
- [ ] Green implementation commit:
- [ ] Targeted tests:
- [ ] Behavior/integration tests:
- [ ] Adjacent suite:
- [ ] `git diff --check`
- [ ] `bun --bun run ci`
- Blocked or skipped proof with reason:
- Evidence quality: deterministic test / local integration / browser smoke / Vercel preview / dev smoke / production smoke / approved exception

## Preview / Release Safety

- Risk tier: Low / Medium / High
- Risk rationale:
- Vercel Preview URL:
- [ ] Preview smoke passed, or not applicable because:
- [ ] Agent Browser Preview review completed, or not applicable because:
- Agent Browser evidence:
- [ ] Dev smoke required for this PR
- Dev evidence, or reason deferred:
- Production smoke plan:
- Rollback plan:
- Fix-forward plan if rollback is unsafe:

## Docs

- [ ] Docs updated, or not needed because:
- Docs/processes affected:

## Deploy / Migration Notes

- Vercel:
- Neon/migrations:
- Upstash/Redis/KV:
- GitHub App/OAuth:
- Sandbox/runtime profiles:
- Background agents/workflows:
- Feature flags/env vars:
- Rollback:

## Linked Issue

Closes #
