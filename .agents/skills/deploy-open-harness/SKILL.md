---
name: deploy-open-harness
description: Guides a user through deploying or debugging a self-hosted Open Agents or older Open Harness fork on Vercel. Use for requests about deploying this app, configuring Vercel OAuth, GitHub Apps, Neon, Upstash Redis/KV, AI Gateway, Vercel Sandbox, or first-run setup.
---

You are helping a user deploy or repair a self-hosted Open Agents install on Vercel.

The skill name is legacy. Treat the current project as Open Agents unless the user explicitly says they are working on the older Open Harness app.

## First Rule

Verify current requirements from the repo before giving setup advice:

- `README.md`
- `apps/web/.env.example`
- `apps/web/lib/auth/config.ts`
- `apps/web/lib/redis.ts`
- `apps/web/lib/rate-limit.ts`
- `packages/agent/models.ts`
- `packages/sandbox/vercel/config.ts`
- `docs/deployment/vercel-open-agents-setup.md` if present

If older docs mention `JWE_SECRET`, `ENCRYPTION_KEY`, `/api/auth/vercel/callback`, or `/api/auth/github/callback`, check current code before repeating them.

## Deployment Shape

Use Vercel hosting with:

```text
Framework: Next.js
Root Directory: apps/web
Install Command: bun install
Build Command: bun run build
Node.js: 24.x
Include source files outside root: enabled
```

Required services:

- Neon Postgres for `POSTGRES_URL`.
- Upstash Redis/KV for `REDIS_URL` or `KV_URL` in production. Production rate-limited endpoints fail closed with `Rate limit unavailable` when Redis is absent or unreachable.
- Vercel AI Gateway for model inference. Vercel deployments can use OIDC automatically; explicit/local auth uses `AI_GATEWAY_API_KEY`.
- Vercel Sandbox for execution.

For Hobby deployments, set:

```env
OPEN_AGENTS_RESOURCE_PROFILE=hobby
```

## Env Checklist

Minimum runtime:

```env
POSTGRES_URL=
BETTER_AUTH_SECRET=
```

Canonical production URL:

```env
BETTER_AUTH_URL=https://YOUR_DOMAIN
VERCEL_PROJECT_PRODUCTION_URL=https://YOUR_DOMAIN
NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL=https://YOUR_DOMAIN
```

Vercel sign-in:

```env
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
VERCEL_APP_CLIENT_SECRET=
```

GitHub repo access:

```env
NEXT_PUBLIC_GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
NEXT_PUBLIC_GITHUB_APP_SLUG=
GITHUB_WEBHOOK_SECRET=
```

Production rate limiting:

```env
REDIS_URL=
# or
KV_URL=
```

Optional:

```env
AI_GATEWAY_API_KEY=
RATE_LIMIT_TIMEOUT_MS=
VERCEL_SANDBOX_BASE_SNAPSHOT_ID=
ELEVENLABS_API_KEY=
```

Never ask the user to paste secrets into chat. Put secrets directly in Vercel env vars or local ignored env files.

## Vercel OAuth App

Create from Vercel Team Settings -> Apps.

Use:

```text
Website: https://YOUR_DOMAIN
Authorization Callback URL: https://YOUR_DOMAIN/api/auth/callback/vercel
```

Scopes:

```text
openid
email
profile
```

Avoid `offline_access` unless the app explicitly allows it. If login redirects with `invalid_scope`, remove unsupported scopes from both the Vercel app settings and the Better Auth provider request.

Store:

```env
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
VERCEL_APP_CLIENT_SECRET=
```

## GitHub App

Do not create a separate GitHub OAuth App. Open Agents uses the GitHub App OAuth credentials for identity and GitHub App installation tokens for repo access.

Configure:

```text
Homepage URL: https://YOUR_DOMAIN
Callback URL: https://YOUR_DOMAIN/api/auth/callback/github
Setup URL: https://YOUR_DOMAIN/api/github/app/callback
Webhook URL: https://YOUR_DOMAIN/api/github/webhook
```

Recommended repository permissions:

```text
Contents: Read and write
Pull requests: Read and write
Checks: Read-only
Commit statuses: Read-only
Deployments: Read-only
Issues: Read-only
Metadata: mandatory
Actions: No access
Workflows: No access unless editing .github/workflows is required
```

Manual event subscriptions are not required for the basic install/repo flow. Add PR, issue, push, check, or workflow events only when the code consumes them.

Store the private key as escaped PEM contents or base64-encoded PEM in `GITHUB_APP_PRIVATE_KEY`.

## Deployment Flow

1. Fork the repo.
2. Import it into Vercel and fix project settings.
3. Add Neon/Postgres and `BETTER_AUTH_SECRET`.
4. Deploy once to get the stable production URL.
5. Set `BETTER_AUTH_URL` and production URL env vars.
6. Create the Vercel OAuth app, add Vercel OAuth env vars, and redeploy.
7. Create the GitHub App, add GitHub env vars, and redeploy.
8. Add Upstash Redis/KV before testing project/session creation in production, then redeploy.
9. Test Vercel login, GitHub App installation, repo selection, session creation, sandbox start, and a simple agent prompt.

## Failure Map

- `invalid_scope` after Vercel sign-in: unsupported OAuth scope, often `offline_access`.
- `Rate limit unavailable`: missing/unreachable `REDIS_URL` or `KV_URL`, or Redis rate-limit checks timing out. Add Upstash Redis/KV, redeploy, and optionally raise `RATE_LIMIT_TIMEOUT_MS`.
- No repos after GitHub install: verify app installation scope, GitHub App env vars, setup callback, and private key format.
- Model calls fail: verify Vercel AI Gateway access/OIDC or set `AI_GATEWAY_API_KEY`.
- Sandbox start fails on Hobby: set `OPEN_AGENTS_RESOURCE_PROFILE=hobby` and redeploy.

## Verification Commands

```bash
vercel env ls --scope <team>
vercel inspect <deployment-url> --scope <team>
vercel logs <deployment-url> --scope <team>
```

After pulling env locally, Redis can be smoke-tested from `apps/web`:

```bash
bun -e 'import Redis from "ioredis"; const r = new Redis(process.env.REDIS_URL ?? process.env.KV_URL); console.log(await r.ping()); r.disconnect();'
```

Keep responses concise and concrete: identify the next missing setup piece, tell the user exactly where it belongs, then verify after redeploy.
