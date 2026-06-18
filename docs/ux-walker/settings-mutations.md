# Settings Surfaces & Data Mutations (authz) — Audit Scratchpad

## Files read
- docs/agents/lessons-learned.md (full)
- apps/web/app/api/settings/* (routes — reading below)

## Assumptions / how the app works
- Better Auth session-based auth. `getSession()` returns the user; `session.user.id` is the owner key for most per-user tables.
- Per-user settings: preferences, agents, model-variants, runtime-profiles, mcp-servers, composio, skills.
- Repo-scoped settings: repositories/[repoOwner]/[repoName] (route + composio subroute).
- Investigate ownership model: is there a per-user WHERE clause on writes? Are IDs validated to belong to the session user (IDOR)?

## Lessons relevant to this domain (so I don't re-report fixed issues)
- L137: GitHub App callbacks must validate server-stored `state` nonce (CSRF). Applies to github install flows, not necessarily settings mutations.
- L105/L106: Request-start assistant snapshot persistence must be ownership-guarded / scoped to stream token. (chat domain, not settings.)
- L150: FK constraints invisible to mock tests; store mocks should enforce FK shape.
- L22: agent-browser fill doesn't update React state; prove write paths with authenticated curl.

## Candidate defects (accept/reject with reasoning)
(to be filled as I read)

## Coverage gaps
(to be filled)
