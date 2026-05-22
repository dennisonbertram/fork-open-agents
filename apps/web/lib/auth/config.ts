import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type {
  GithubProfile,
  VercelProfile,
} from "better-auth/social-providers";
import { nanoid } from "nanoid";
import {
  getAllowedAuthHosts,
  getAuthBaseURLFallback,
} from "@/lib/auth/base-url";
import { deriveAuthUsername } from "@/lib/auth/username";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

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
      mapProfileToUser: mapGitHubProfileToUser,
    },
  },

  advanced: {
    database: {
      generateId: () => nanoid(),
    },
  },
});
