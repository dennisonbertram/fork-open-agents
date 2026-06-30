---
name: open-agents-vercel-setup
description: Captures the current self-hosted Open Agents Vercel setup workflow. Use when configuring or debugging Open Agents on Vercel, especially OAuth callbacks, GitHub App permissions, Redis rate limits, AI Gateway inference, Vercel Sandbox, or production env vars.
---

Use this skill for Open Agents self-hosting on Vercel.

If the request is about production status, release promotion, incidents,
scheduled smoke, env isolation, alerting, or branch safety gates, also read
`.agents/skills/production-ops/SKILL.md` and follow its operator loop.

First read current repo files, especially:

- `docs/deployment/vercel-open-agents-setup.md`
- `apps/web/.env.example`
- `apps/web/lib/auth/config.ts`
- `apps/web/lib/rate-limit.ts`
- `packages/agent/models.ts`

Core facts:

- Vercel project root is `apps/web`; install from repo root with `bun install`; build with `bun run build`.
- Vercel sign-in callback is `/api/auth/callback/vercel`; supported scopes are `openid`, `email`, `profile`.
- GitHub App OAuth callback is `/api/auth/callback/github`; setup URL is `/api/github/app/callback`; webhook URL is `/api/github/webhook`.
- GitHub App permissions should start narrow: Contents and Pull requests read/write; Checks, Commit statuses, Deployments, Issues read-only; Metadata mandatory; Actions/Workflows off unless needed.
- Production needs `REDIS_URL` or `KV_URL` for rate-limited endpoints. `Rate limit unavailable` means Redis is absent, unreachable, or timed out.
- Inference comes through AI SDK `createGateway()` / Vercel AI Gateway. Vercel deployments can use OIDC; explicit/local auth uses `AI_GATEWAY_API_KEY`.
- `OPEN_AGENTS_RESOURCE_PROFILE=hobby` is useful for constrained Vercel plans.

When diagnosing failures:

- First run `bun run ops:status -- --since 30m` when the repo checkout and
  Vercel/GitHub CLI access are available.
- Use `bun run ops:env-isolation -- --compare dev` before treating dev or
  preview as safe for destructive production-shaped testing.
- `invalid_scope`: remove unsupported Vercel OAuth scopes such as `offline_access`.
- `Rate limit unavailable`: verify Upstash Redis/KV env exists in Production and redeploy.
- Model errors: check AI Gateway project access/OIDC or add `AI_GATEWAY_API_KEY`.
- Missing repos: check GitHub App install scope, private key env, app slug/client ID/client secret, and setup callback.

Do not ask the user to paste secrets into chat. Store secrets in Vercel env or ignored local env files.
