/**
 * Sandbox timeout configuration.
 * All timeout values are in milliseconds.
 */

import { isHobbyResourceProfile } from "@/lib/deployment/resource-profile";

/** SDK safety buffer reserved for sandbox before-stop hooks (30 seconds) */
const VERCEL_SANDBOX_TIMEOUT_BUFFER_MS = 30 * 1000;

/** Standard timeout for new cloud sandboxes (5 hours minus hook buffer) */
const STANDARD_SANDBOX_TIMEOUT_MS =
  5 * 60 * 60 * 1000 - VERCEL_SANDBOX_TIMEOUT_BUFFER_MS;

/** Hobby-compatible timeout for new cloud sandboxes (40 minutes minus hook buffer) */
const HOBBY_SANDBOX_TIMEOUT_MS =
  40 * 60 * 1000 - VERCEL_SANDBOX_TIMEOUT_BUFFER_MS;

/** Default timeout for new cloud sandboxes */
export const DEFAULT_SANDBOX_TIMEOUT_MS = isHobbyResourceProfile()
  ? HOBBY_SANDBOX_TIMEOUT_MS
  : STANDARD_SANDBOX_TIMEOUT_MS;

/** Default vCPU count for new cloud sandboxes */
export const DEFAULT_SANDBOX_VCPUS = isHobbyResourceProfile() ? 1 : 4;

/**
 * Sizing for an unattended background-agent run.
 *
 * These are deliberately separate from the interactive defaults above. A chat
 * session is a person waiting on a prompt, so it gets the larger box and stays
 * alive between turns until hibernation stops it. A background-agent run is a
 * batch job: its agent is capped at 10 minutes (`DEFAULT_AGENT_TIMEOUT_MS`),
 * its check commands at 2 minutes, and nothing waits on it interactively.
 *
 * Measured over 12.52 days before these existed: 73 background sandboxes ran
 * at 4 vCPUs — the Vercel SDK allocates 2048 MB per vCPU, so 8192 MB — with a
 * median life of exactly the 300-minute ceiling and 2.37 median CPU-minutes of
 * work. Provisioned memory is billed on wall-clock life, so that was $43.86 of
 * a $59.73 total. The timeout below is a runaway backstop, not a schedule; the
 * `finally` in the executor is what actually ends a run's sandbox.
 */
export const BACKGROUND_AGENT_SANDBOX_VCPUS = isHobbyResourceProfile() ? 1 : 2;

/** Runaway backstop for a background-agent run (30 minutes minus hook buffer) */
export const BACKGROUND_AGENT_SANDBOX_TIMEOUT_MS = Math.min(
  30 * 60 * 1000 - VERCEL_SANDBOX_TIMEOUT_BUFFER_MS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
);

/** Manual extension duration for explicit fallback flows (20 minutes) */
export const EXTEND_TIMEOUT_DURATION_MS = 20 * 60 * 1000;

/** Default inactivity window before lifecycle hibernates an idle sandbox (30 minutes) */
const DEFAULT_SANDBOX_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** Lower bound so a misconfigured value can't hibernate almost immediately (60 seconds) */
const MIN_SANDBOX_INACTIVITY_TIMEOUT_MS = 60 * 1000;

/**
 * Resolve the inactivity window from an operator-provided value.
 *
 * A longer window keeps an idle sandbox resumable (fast restarts) at the cost
 * of provisioned-memory billing for the extra idle wall-clock. The effective
 * ceiling is still the sandbox session expiry (see getLifecycleDueAtMs), so
 * this only controls the idle-hibernation tail. Invalid, empty, zero, or
 * negative input falls back to the 30-minute default; values between 0 and the
 * 60s floor are clamped up to the floor.
 */
export function resolveSandboxInactivityTimeoutMs(
  raw: string | undefined,
): number {
  if (raw === undefined) {
    return DEFAULT_SANDBOX_INACTIVITY_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SANDBOX_INACTIVITY_TIMEOUT_MS;
  }

  return Math.max(parsed, MIN_SANDBOX_INACTIVITY_TIMEOUT_MS);
}

/**
 * Inactivity window before lifecycle hibernates an idle sandbox.
 * Defaults to 30 minutes; override with SANDBOX_INACTIVITY_TIMEOUT_MS (ms).
 */
export const SANDBOX_INACTIVITY_TIMEOUT_MS = resolveSandboxInactivityTimeoutMs(
  process.env.SANDBOX_INACTIVITY_TIMEOUT_MS,
);

/** Buffer for sandbox expiry checks (10 seconds) */
export const SANDBOX_EXPIRES_BUFFER_MS = 10 * 1000;

/** Grace window before treating a lifecycle run as stale (2 minutes) */
export const SANDBOX_LIFECYCLE_STALE_RUN_GRACE_MS = 2 * 60 * 1000;

/** Minimum sleep between lifecycle workflow loop iterations (5 seconds) */
export const SANDBOX_LIFECYCLE_MIN_SLEEP_MS = 5 * 1000;

/**
 * Default ports to expose from cloud sandboxes.
 * Limited to 5 ports. Covers the most common framework defaults
 * plus the built-in code editor:
 * - 3000: Next.js, Express, Remix
 * - 5173: Vite, SvelteKit
 * - 4321: Astro
 * - 8000: code-server (built-in editor)
 */
export const DEFAULT_SANDBOX_PORTS = [3000, 5173, 4321, 8000];
export const CODE_SERVER_PORT = 8000;

/** Default working directory for sandboxes, used for path display */
export const DEFAULT_WORKING_DIRECTORY = "/vercel/sandbox";

/**
 * Optional base snapshot for fresh cloud sandboxes.
 *
 * Forked deployments should provide their own snapshot ID if they want a
 * preconfigured image. When unset, sandboxes start from Vercel's standard
 * runtime so deployments are not tied to a private snapshot in another scope.
 */
export const DEFAULT_SANDBOX_BASE_SNAPSHOT_ID =
  process.env.VERCEL_SANDBOX_BASE_SNAPSHOT_ID;
