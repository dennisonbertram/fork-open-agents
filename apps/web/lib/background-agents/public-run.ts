import type { BackgroundAgent, BackgroundAgentRun } from "@/lib/db/schema";
import {
  hashBackgroundAgentExecutionSnapshot,
  parseBackgroundAgentExecutionSnapshot,
  type BackgroundAgentExecutionSnapshotV1,
} from "./execution-snapshot";

export type BackgroundAgentSnapshotSource =
  | "frozen"
  | "legacy_live_fallback"
  | "invalid";

export type PublicBackgroundAgentRun = Omit<
  BackgroundAgentRun,
  "executionSnapshot"
> & { snapshotSource: BackgroundAgentSnapshotSource };

type PublicSnapshotResolution =
  | { source: "legacy_live_fallback"; snapshot: null }
  | { source: "invalid"; snapshot: null }
  | { source: "frozen"; snapshot: BackgroundAgentExecutionSnapshotV1 };

function resolvePublicSnapshot(
  run: Pick<
    BackgroundAgentRun,
    | "executionSnapshot"
    | "definitionVersion"
    | "definitionHash"
    | "repoOwner"
    | "repoName"
    | "agentId"
  >,
): PublicSnapshotResolution {
  const tuple = [
    run.executionSnapshot,
    run.definitionVersion,
    run.definitionHash,
  ];
  const present = tuple.filter((value) => value != null).length;
  if (present === 0) {
    return { source: "legacy_live_fallback", snapshot: null };
  }
  if (present !== 3 || run.definitionVersion !== 1) {
    return { source: "invalid", snapshot: null };
  }

  try {
    const snapshot = parseBackgroundAgentExecutionSnapshot(
      run.executionSnapshot,
    );
    if (
      snapshot.snapshotVersion !== run.definitionVersion ||
      hashBackgroundAgentExecutionSnapshot(snapshot) !== run.definitionHash ||
      snapshot.repository.owner.toLowerCase() !== run.repoOwner.toLowerCase() ||
      snapshot.repository.name.toLowerCase() !== run.repoName.toLowerCase() ||
      (run.agentId !== null && snapshot.source.definitionId !== run.agentId)
    ) {
      return { source: "invalid", snapshot: null };
    }
    return { source: "frozen", snapshot };
  } catch {
    return { source: "invalid", snapshot: null };
  }
}

export function getBackgroundAgentSnapshotSource(
  run: Pick<
    BackgroundAgentRun,
    | "executionSnapshot"
    | "definitionVersion"
    | "definitionHash"
    | "repoOwner"
    | "repoName"
    | "agentId"
  >,
): BackgroundAgentSnapshotSource {
  return resolvePublicSnapshot(run).source;
}

export function toPublicBackgroundAgentRun(
  run: BackgroundAgentRun,
): PublicBackgroundAgentRun {
  const { executionSnapshot: _privateSnapshot, ...safeRun } = run;
  return { ...safeRun, snapshotSource: getBackgroundAgentSnapshotSource(run) };
}

export type SafeBackgroundAgentEvidence = {
  id: string;
  name: string;
  permissions: unknown;
  checkConfigured: boolean;
  sourceDeleted: boolean;
};

export function toSafeBackgroundAgentEvidence(
  run: BackgroundAgentRun,
  liveAgent: BackgroundAgent | null,
): SafeBackgroundAgentEvidence | null {
  const resolved = resolvePublicSnapshot(run);
  if (resolved.source === "invalid") return null;
  if (resolved.source === "frozen") {
    return {
      id: resolved.snapshot.source.definitionId,
      name: resolved.snapshot.source.name,
      permissions: resolved.snapshot.permissions,
      checkConfigured: Boolean(resolved.snapshot.checkCommand?.trim()),
      sourceDeleted: liveAgent === null,
    };
  }
  return liveAgent
    ? {
        id: liveAgent.id,
        name: liveAgent.name,
        permissions: liveAgent.permissions,
        checkConfigured: Boolean(liveAgent.checkCommand?.trim()),
        sourceDeleted: false,
      }
    : null;
}
