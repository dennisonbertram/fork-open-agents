# Vercel Open Agents Setup Notes

This is the deployment path we used to bring a vanilla Open Agents fork online on Vercel with Vercel OAuth, a GitHub App, Neon Postgres, Upstash Redis, AI Gateway, and Vercel Sandboxes.

## Working Deployment Shape

- Hosting: Vercel project with framework `nextjs`, root directory `apps/web`, install command `bun install`, build command `bun run build`, Node.js 24.x, and source files outside the root directory enabled.
- Database: Neon Postgres connected through the Vercel integration. Migrations run during `bun run build`.
- Redis: Upstash Redis or KV connected through Vercel. Production rate-limited endpoints return `Rate limit unavailable` without `REDIS_URL` or `KV_URL`.
- Auth: Better Auth social providers for Vercel and GitHub.
- Repo access: GitHub App installation tokens.
- Inference: AI SDK `createGateway()` through Vercel AI Gateway. On Vercel, OIDC auth can work without provider API keys; for explicit/local key auth use `AI_GATEWAY_API_KEY`.
- Execution: Vercel Sandbox for repo clones, shell commands, dev servers, and snapshots.

## Vercel Project

Import the fork into Vercel and verify these project settings:

```text
Framework Preset: Next.js
Root Directory: apps/web
Install Command: bun install
Build Command: bun run build
Node.js Version: 24.x
Include source files outside of the Root Directory: enabled
```

For Hobby-compatible deploys, set:

```env
OPEN_AGENTS_RESOURCE_PROFILE=hobby
```

Set the canonical URL vars to the stable production alias:

```env
BETTER_AUTH_URL=https://YOUR_DOMAIN
VERCEL_PROJECT_PRODUCTION_URL=https://YOUR_DOMAIN
NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL=https://YOUR_DOMAIN
```

## Required Environment Variables

Minimum runtime:

```env
POSTGRES_URL=
BETTER_AUTH_SECRET=
```

Required for Vercel sign-in:

```env
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
VERCEL_APP_CLIENT_SECRET=
```

Required for GitHub-backed repo work:

```env
NEXT_PUBLIC_GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
NEXT_PUBLIC_GITHUB_APP_SLUG=
GITHUB_WEBHOOK_SECRET=
```

Required for production session/sandbox creation rate limiting:

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

## Vercel OAuth App

Create the app from Vercel Team Settings -> Apps.

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

Do not enable `offline_access` unless the Vercel app explicitly supports it. If sign-in redirects back with `invalid_scope`, remove `offline_access` from the Vercel app and from the requested provider scopes.

Store:

```env
NEXT_PUBLIC_VERCEL_APP_CLIENT_ID=
VERCEL_APP_CLIENT_SECRET=
```

## GitHub App

Use the GitHub App itself for both OAuth identity and installation-based repo access. A separate GitHub OAuth app is not required.

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
Workflows: No access, unless editing .github/workflows is required later
```

Webhook events:

```text
No manual event subscriptions are needed for the basic flow.
```

GitHub Apps always receive installation lifecycle events needed for install/update sync. Add more event subscriptions only when a feature needs live issue, PR, push, or check updates.

Private key handling:

- Generate a GitHub App private key.
- Store `GITHUB_APP_PRIVATE_KEY` as either escaped PEM contents or base64-encoded PEM.
- Do not commit the key.

## First-Run Verification

1. Redeploy after every env or OAuth callback change.
2. Open the production URL and sign in with Vercel.
3. Install or update the GitHub App for the account/org whose repos should appear.
4. Start a repo-backed session.
5. If project creation fails with `Rate limit unavailable`, check that `REDIS_URL` or `KV_URL` is present in production and redeploy.
6. If Vercel sign-in returns `invalid_scope`, confirm the Vercel app scopes are only `openid`, `email`, and `profile`.
7. If model calls fail, check Vercel AI Gateway access/OIDC or set `AI_GATEWAY_API_KEY`.

## Useful CLI Checks

```bash
vercel env ls --scope <team>
vercel inspect <deployment-url> --scope <team>
vercel logs <deployment-url> --scope <team>
```

For local Redis smoke testing after pulling Vercel env:

```bash
cd apps/web
bun -e 'import Redis from "ioredis"; const r = new Redis(process.env.REDIS_URL ?? process.env.KV_URL); console.log(await r.ping()); r.disconnect();'
```
