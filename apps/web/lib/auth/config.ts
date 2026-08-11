import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { mcp } from "better-auth/plugins";
import type {
  GithubProfile,
  VercelProfile,
} from "better-auth/social-providers";
import { nanoid } from "nanoid";
import {
  getAllowedAuthHosts,
  getAuthBaseURLFallback,
} from "@/lib/auth/base-url";
import { forceMcpConsentPrompt } from "@/lib/auth/mcp-consent-hook";
import { deriveAuthUsername } from "@/lib/auth/username";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { MCP_SCOPES } from "@/lib/mcp-server/context";

function mapVercelProfileToUser(profile: VercelProfile): { username: string } {
  return {
    username: deriveAuthUsername({
      id: profile.sub,
      preferred_username: profile.preferred_username,
      email: profile.email,
      name: profile.name,
    }),
  };
}

function mapGitHubProfileToUser(profile: GithubProfile): { username: string } {
  return {
    username: deriveAuthUsername({
      id: profile.id,
      username: profile.login,
      email: profile.email,
      name: profile.name,
    }),
  };
}

const authBaseURLFallback = getAuthBaseURLFallback();
const authAllowedHosts = getAllowedAuthHosts();
const vercelRedirectURI = authBaseURLFallback
  ? new URL("/api/auth/callback/vercel", authBaseURLFallback).toString()
  : undefined;

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: {
    allowedHosts: authAllowedHosts,
    ...(authBaseURLFallback ? { fallback: authBaseURLFallback } : {}),
  },

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      users: schema.users,
      auth_sessions: schema.authSessions,
      account: schema.accounts,
      verification: schema.verification,
      oauthApplication: schema.oauthApplications,
      oauthAccessToken: schema.oauthAccessTokens,
      oauthConsent: schema.oauthConsents,
    },
  }),

  user: {
    modelName: "users",
    fields: {
      image: "avatarUrl",
    },
    additionalFields: {
      username: { type: "string", required: true },
      lastLoginAt: { type: "date", required: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            username: deriveAuthUsername(user),
          },
        }),
      },
    },
  },

  session: {
    modelName: "auth_sessions",
  },

  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: ["vercel", "github"],
      allowDifferentEmails: true,
    },
  },

  socialProviders: {
    vercel: {
      clientId: process.env.NEXT_PUBLIC_VERCEL_APP_CLIENT_ID ?? "",
      clientSecret: process.env.VERCEL_APP_CLIENT_SECRET ?? "",
      ...(vercelRedirectURI ? { redirectURI: vercelRedirectURI } : {}),
      scope: ["openid", "email", "profile"],
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: mapVercelProfileToUser,
    },
    github: {
      clientId: process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      // "repo" is required to create repositories on behalf of the user.
      // Only affects new consents; existing tokens get the typed
      // github_scope_required error until they reconnect.
      scope: ["read:user", "user:email", "repo"],
      mapProfileToUser: mapGitHubProfileToUser,
    },
  },

  advanced: {
    database: {
      generateId: () => nanoid(),
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => forceMcpConsentPrompt(ctx)),
  },

  rateLimit: {
    // better-auth resolves `enabled: options.rateLimit?.enabled ?? isProduction`
    // (dist/context/create-context.mjs), so leaving this unset would make the
    // rule below inert everywhere except production — including preview, where
    // the same public endpoint is reachable.
    enabled: true,
    // Counters live in a module-level Map in better-auth's default rate
    // limiter, so on Vercel the cap is per warm instance rather than global.
    // Switch to `storage: "database"` (needs a rateLimit table + migration) if
    // a global bound is ever required.
    customRules: {
      // /mcp/register is unauthenticated by design (RFC 7591 dynamic client
      // registration) and each call inserts a row into oauth_applications
      // with no other bound — cap it per IP so it can't be used to flood
      // the table.
      "/mcp/register": { window: 60, max: 10 },
    },
  },

  plugins: [
    mcp({
      loginPage: "/mcp/login",
      oidcConfig: {
        loginPage: "/mcp/login",
        consentPage: "/mcp/consent",
        scopes: [...MCP_SCOPES],
        defaultScope: "sessions:read",
        // Defence in depth against a malicious dynamically-registered client
        // supplying its own code_verifier: require PKCE on every authorize
        // request and disallow the weak "plain" challenge method (the mcp
        // plugin otherwise defaults requirePKCE to falsy/unset and
        // allowPlainCodeChallengeMethod to true).
        requirePKCE: true,
        allowPlainCodeChallengeMethod: false,
        // better-auth's discovery documents default scopes_supported to the
        // OIDC-only set (openid/profile/email/offline_access), so a
        // spec-following MCP client that requests the advertised scopes gets
        // zero MCP scopes and sees no tools. Advertise the real MCP scopes
        // too. Read by getMCPProtectedResourceMetadata directly, and by the
        // hand-built AS discovery route (getMCPProviderMetadata's issuer
        // check is broken for our dynamic baseURL config, see
        // app/.well-known/oauth-authorization-server/route.ts).
        metadata: {
          scopes_supported: [
            ...MCP_SCOPES,
            "openid",
            "profile",
            "email",
            "offline_access",
          ],
        },
      },
    }),
  ],
});
