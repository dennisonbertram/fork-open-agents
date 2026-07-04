"use client";

/**
 * useComposioConnect — the ONE honest connect flow (#801, epic #796 T5,
 * consolidating #736 item 2).
 *
 * Replaces three divergent connect implementations (composio-tool-catalog's
 * inline handleConnect, and would-be duplicates in the picker/agent-builder)
 * with one hook that:
 * - opens the OAuth popup/tab and detects popup blocking (derivePopupOutcome)
 * - never fires an optimistic success toast (C1) — only a pending state
 * - polls /api/composio/connected-accounts until the target slug reaches
 *   ACTIVE or a timeout elapses (deriveConnectPollOutcome), and stops polling
 *   either way
 * - logs (not swallows) the three structured client events named in issue
 *   #801's Observability section: composio.connect.popup_blocked,
 *   composio.connect.pending_timeout, composio.connect.confirmed
 *
 * The popup-block detection and poll-outcome derivation are pure functions
 * in composio-connect-state.ts, unit-tested directly (see
 * use-composio-connect.test.ts). This hook itself is the thin,
 * window/fetch/timer-driven shell around them — the same split
 * use-background-run-polling.ts uses for its pure refresh-interval function.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { buildToolkitStatusMap } from "./composio-connection-state";
import {
  deriveConnectPollOutcome,
  derivePopupOutcome,
} from "./composio-connect-state";
import type { ComposioConnectedAccountsResponse } from "@/app/api/composio/connected-accounts/route";

export type ConnectState =
  | { status: "idle" }
  | { status: "connecting"; slug: string }
  | { status: "pending"; slug: string }
  | { status: "confirmed"; slug: string }
  | { status: "timed_out"; slug: string }
  | { status: "blocked"; slug: string }
  | { status: "failed_to_start"; slug: string; message: string };

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  return res.json() as Promise<T>;
}

/** Fields for the client-side telemetry events named in issue #801. */
function logConnectEvent(
  name:
    | "composio.connect.popup_blocked"
    | "composio.connect.pending_timeout"
    | "composio.connect.confirmed",
  fields: { toolkitSlug: string; pollDurationMs?: number },
) {
  // eslint-disable-next-line no-console -- intentional client telemetry, see issue #801 Observability section
  console.info(name, fields);
}

export interface UseComposioConnectResult {
  connectState: ConnectState;
  /**
   * Starts the connect flow for a toolkit slug: POSTs /api/composio/connect,
   * opens the returned redirect URL, and (if the popup opened) begins
   * polling connected-accounts for that slug to reach ACTIVE.
   */
  connect: (slug: string) => Promise<void>;
  /** Resets connectState back to idle (e.g. after showing timeout/blocked copy). */
  reset: () => void;
}

/**
 * Shared connect-flow hook. `onConfirmed` is called once the poll confirms
 * the slug reached ACTIVE, so callers can refresh their own connected-accounts
 * SWR cache (mutate) without this hook needing to own that cache.
 */
export function useComposioConnect(params?: {
  onConfirmed?: (slug: string) => void;
}): UseComposioConnectResult {
  const [connectState, setConnectState] = useState<ConnectState>({
    status: "idle",
  });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onConfirmedRef = useRef(params?.onConfirmed);
  onConfirmedRef.current = params?.onConfirmed;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Stop any in-flight poll on unmount so a closed tab never keeps polling.
  useEffect(() => stopPolling, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setConnectState({ status: "idle" });
  }, [stopPolling]);

  const beginPolling = useCallback(
    (slug: string) => {
      const startedAt = Date.now();
      stopPolling();
      pollTimerRef.current = setInterval(() => {
        void (async () => {
          let response: ComposioConnectedAccountsResponse | null = null;
          try {
            response = await jsonFetcher<ComposioConnectedAccountsResponse>(
              "/api/composio/connected-accounts",
            );
          } catch {
            response = null;
          }

          const statusMap = buildToolkitStatusMap(response?.accounts ?? []);
          const elapsedMs = Date.now() - startedAt;
          const outcome = deriveConnectPollOutcome({
            slug,
            statusMap,
            unavailable: response === null || response.unavailable === true,
            elapsedMs,
            timeoutMs: POLL_TIMEOUT_MS,
          });

          if (outcome === "confirmed") {
            stopPolling();
            setConnectState({ status: "confirmed", slug });
            logConnectEvent("composio.connect.confirmed", {
              toolkitSlug: slug,
              pollDurationMs: elapsedMs,
            });
            onConfirmedRef.current?.(slug);
            return;
          }
          if (outcome === "timed_out") {
            stopPolling();
            setConnectState({ status: "timed_out", slug });
            logConnectEvent("composio.connect.pending_timeout", {
              toolkitSlug: slug,
              pollDurationMs: elapsedMs,
            });
            return;
          }
          setConnectState({ status: "pending", slug });
        })();
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  const connect = useCallback(
    async (slug: string) => {
      setConnectState({ status: "connecting", slug });
      try {
        const res = await fetch("/api/composio/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolkitSlug: slug }),
        });
        const body = (await res.json().catch(() => null)) as {
          redirectUrl?: string;
          error?: string;
        } | null;

        if (!res.ok || !body?.redirectUrl) {
          setConnectState({
            status: "failed_to_start",
            slug,
            message: body?.error ?? "Failed to start connection",
          });
          return;
        }

        const popup = window.open(body.redirectUrl, "_blank");
        const outcome = derivePopupOutcome(popup);

        if (outcome === "blocked") {
          setConnectState({ status: "blocked", slug });
          logConnectEvent("composio.connect.popup_blocked", {
            toolkitSlug: slug,
          });
          return;
        }

        // Honest pending state — no optimistic success (C1). Confirmation
        // only happens once the poll observes the slug reach ACTIVE.
        setConnectState({ status: "pending", slug });
        beginPolling(slug);
      } catch (error) {
        setConnectState({
          status: "failed_to_start",
          slug,
          message:
            error instanceof Error
              ? error.message
              : "Failed to start connection",
        });
      }
    },
    [beginPolling],
  );

  return { connectState, connect, reset };
}
