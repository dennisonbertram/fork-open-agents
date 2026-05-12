"use client";

import useSWR from "swr";
import { fetcherNoStore } from "@/lib/swr";
import type {
  HarnessRunResponse,
  VerifiedBuildEventSnapshot,
  VerifiedBuildRunSnapshot,
} from "@/lib/harness/types";

export type VerifiedBuildRunJson = Omit<
  VerifiedBuildRunSnapshot,
  "createdAt" | "updatedAt" | "lastEventAt"
> & {
  createdAt: string;
  updatedAt: string;
  lastEventAt: string | null;
};

export type VerifiedBuildEventJson = Omit<
  VerifiedBuildEventSnapshot,
  "eventAt" | "receivedAt"
> & {
  eventAt: string | null;
  receivedAt: string;
};

export type VerifiedBuildRunResponse = {
  run: VerifiedBuildRunJson | null;
  events: VerifiedBuildEventJson[];
  harnessRun?: HarnessRunResponse;
};

export function useVerifiedBuildRun(params: {
  sessionId: string;
  chatId: string;
  enabled?: boolean;
}) {
  const enabled = params.enabled ?? true;
  const key = enabled
    ? `/api/harness/runs?sessionId=${encodeURIComponent(
        params.sessionId,
      )}&chatId=${encodeURIComponent(params.chatId)}`
    : null;

  return useSWR<VerifiedBuildRunResponse>(key, fetcherNoStore, {
    revalidateOnFocus: false,
  });
}
