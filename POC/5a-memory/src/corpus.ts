/**
 * Realistic seed corpus across two users and two repos.
 *
 * The shape exercises the scoping boundary: userA owns repoX, userB owns repoY.
 * Each scope has a mix of decisions, conventions, fixes, and facts — including
 * deliberately UNRELATED entries (CSS/formatting) that must NOT surface for an
 * auth or rate-limit query.
 */

import type { MemoryKind } from "./schema";

export type SeedMemory = {
  userId: string;
  repoOwner: string;
  repoName: string;
  kind: MemoryKind;
  content: string;
  sourceSessionId: string;
};

export const USER_A = "user_alice";
export const USER_B = "user_bob";
export const REPO_X = { owner: "alice-org", name: "checkout-service" };
export const REPO_Y = { owner: "bob-org", name: "marketing-site" };

export const SEED_CORPUS: SeedMemory[] = [
  // --- userA / repoX (auth + rate limiting + sessions) ---
  {
    userId: USER_A,
    repoOwner: REPO_X.owner,
    repoName: REPO_X.name,
    kind: "decision",
    content:
      "We decided to use Better Auth for authentication, not NextAuth. Migration off NextAuth was completed in the auth refactor.",
    sourceSessionId: "sess_a1",
  },
  {
    userId: USER_A,
    repoOwner: REPO_X.owner,
    repoName: REPO_X.name,
    kind: "convention",
    content:
      "The rate limiter returns HTTP 429 with a Retry-After header indicating seconds until the next allowed request.",
    sourceSessionId: "sess_a2",
  },
  {
    userId: USER_A,
    repoOwner: REPO_X.owner,
    repoName: REPO_X.name,
    kind: "fix",
    content:
      "Fixed a null pointer in session hydration: the TTL was read before the session cache was populated, crashing on cold start.",
    sourceSessionId: "sess_a3",
  },
  {
    userId: USER_A,
    repoOwner: REPO_X.owner,
    repoName: REPO_X.name,
    kind: "convention",
    content:
      "Use 2-space indentation and double quotes. Formatting is enforced by the linter on commit.",
    sourceSessionId: "sess_a4",
  },
  {
    userId: USER_A,
    repoOwner: REPO_X.owner,
    repoName: REPO_X.name,
    kind: "fact",
    content:
      "Payments are processed through Stripe; webhook signatures are verified with the Stripe-Signature header.",
    sourceSessionId: "sess_a5",
  },
  {
    userId: USER_A,
    repoOwner: REPO_X.owner,
    repoName: REPO_X.name,
    kind: "convention",
    content:
      "Database migrations are generated with Drizzle Kit and run automatically during the build step.",
    sourceSessionId: "sess_a6",
  },

  // --- userB / repoY (different domain entirely; must never leak to A) ---
  {
    userId: USER_B,
    repoOwner: REPO_Y.owner,
    repoName: REPO_Y.name,
    kind: "decision",
    content:
      "We decided to use Clerk for authentication on the marketing site because of its drop-in React components.",
    sourceSessionId: "sess_b1",
  },
  {
    userId: USER_B,
    repoOwner: REPO_Y.owner,
    repoName: REPO_Y.name,
    kind: "convention",
    content:
      "Marketing copy lives in Contentful; never hardcode hero headlines in the components.",
    sourceSessionId: "sess_b2",
  },
  {
    userId: USER_B,
    repoOwner: REPO_Y.owner,
    repoName: REPO_Y.name,
    kind: "fix",
    content:
      "Fixed layout shift on the pricing page by reserving image dimensions to stop cumulative layout shift.",
    sourceSessionId: "sess_b3",
  },
];
