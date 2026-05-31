// A minimal stand-in for a `sandbox_services` row from
// apps/web/lib/db/schema.ts (sandboxServices table). The load-bearing field for
// this POC is `relaunchOnResume` (schema.ts:355, default true), which decides
// whether a service is re-launched after a hibernate/resume cycle.
//
// In production, relaunch is driven by the `onResume` lifecycle hook
// (https://vercel.com/docs/sandbox/concepts/persistent-sandboxes — "Use it to
// restart background services") and by apps/web service-launch.ts which records
// `relaunchOnResume: true` for managed dev servers (service-launch.ts:689).

export type ServiceKind = "dev_server" | "code_editor" | "custom";

export type ServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "failed"
  | "stale";

export interface ServiceRecord {
  id: string;
  kind: ServiceKind;
  status: ServiceStatus;
  /** Workspace-relative directory the service runs in. */
  packageDir: string | null;
  /** The command used to (re)launch the service. */
  command: string;
  port: number;
  /** Whether the service should be re-launched after resume (schema default true). */
  relaunchOnResume: boolean;
  /** Process id of the live process (null when not running). In-memory: does NOT survive. */
  pid: string | null;
}

/**
 * Model of WHAT SURVIVES hibernation. This is the contract the POC proves out.
 *
 *   filesystem        -> YES  (Vercel snapshots the disk on stop)
 *   git working tree  -> YES  (it lives on the filesystem; reuses POC 3b insight)
 *   service RECORDS   -> YES  (persisted as sandboxServices rows in Postgres,
 *                              outside the sandbox — survive because they are in the DB)
 *   running PROCESSES -> NO   (a snapshot is filesystem-only; the VM is town down)
 *   in-memory state   -> NO   (RAM is not part of a filesystem snapshot)
 *
 * Therefore on resume, services with relaunchOnResume=true must be RE-LAUNCHED
 * from their recorded command; their old pid is meaningless.
 */
export const HIBERNATION_SURVIVAL = {
  filesystem: true,
  gitWorkingTree: true,
  serviceRecords: true,
  runningProcesses: false,
  inMemoryState: false,
} as const;

/** Strip volatile, process-bound fields that cannot survive a teardown. */
export function toResumableServiceRecord(service: ServiceRecord): ServiceRecord {
  return {
    ...service,
    // The live process is gone after teardown; its pid must not be carried over.
    pid: null,
    // A service that was running is now stopped until relaunch decides otherwise.
    status: service.relaunchOnResume ? "stopped" : "stopped",
  };
}
