import type { BackgroundAgent, BackgroundAgentRun } from "@/lib/db/schema";
import { parseBackgroundAgentExecutionSnapshot } from "./execution-snapshot";

export type BackgroundAgentSnapshotSource =
  | "frozen"
  | "legacy_live_fallback"
  | "invalid";

export type PublicBackgroundAgentRun = Omit<
  BackgroundAgentRun,
  "executionSnapshot"
> & { snapshotSource: BackgroundAgentSnapshotSource };

export function getBackgroundAgentSnapshotSource(
  run: Pick<
    BackgroundAgentRun,
    "executionSnapshot" | "definitionVersion" | "definitionHash"
  >,
): BackgroundAgentSnapshotSource {
  const present = [
    run.executionSnapshot,
    run.definitionVersion,
    run.definitionHash,
  ].filter((value) => value != null).length;
  if (present === 0) return "legacy_live_fallback";
  return present === 3 ? "frozen" : "invalid";
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
  checkCommand: string | null;
  sourceDeleted: boolean;
};

export function toSafeBackgroundAgentEvidence(
  run: BackgroundAgentRun,
  liveAgent: BackgroundAgent | null,
): SafeBackgroundAgentEvidence | null {
  if (
    run.executionSnapshot &&
    run.definitionVersion === 1 &&
    run.definitionHash
  ) {
    try {
      const snapshot = parseBackgroundAgentExecutionSnapshot(
        run.executionSnapshot,
      );
      return {
        id: snapshot.source.definitionId,
        name: snapshot.source.name,
        permissions: snapshot.permissions,
        checkCommand: snapshot.checkCommand,
        sourceDeleted: liveAgent === null,
      };
    } catch {
      return liveAgent
        ? {
            id: liveAgent.id,
            name: liveAgent.name,
            permissions: {},
            checkCommand: null,
            sourceDeleted: false,
          }
        : null;
    }
  }
  return liveAgent
    ? {
        id: liveAgent.id,
        name: liveAgent.name,
        permissions: liveAgent.permissions,
        checkCommand: liveAgent.checkCommand,
        sourceDeleted: false,
      }
    : null;
}
