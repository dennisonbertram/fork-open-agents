// SandboxOrchestrator — wires the LifecycleMachine to a SnapshotProvider and
// owns the hibernate/resume flow + service relaunch. This is the POC analogue of
// apps/web/lib/sandbox/lifecycle.ts (evaluateSandboxLifecycle) plus the
// onResume service-relaunch behaviour.
//
//   hibernate(): active -> hibernating -> [snapshot+teardown] -> hibernated
//   resume():    hibernated -> restoring -> [boot+restore+relaunch] -> active
//
// Service relaunch mirrors the production onResume hook + service-launch.ts:
// only services with relaunchOnResume=true are re-launched; the launcher records
// a NEW pid (proving processes are recreated, not restored).
import { randomUUID } from "node:crypto";
import { LifecycleMachine } from "./lifecycle";
import type {
  SandboxInstance,
  SnapshotProvider,
  SnapshotRef,
} from "./provider";
import type { ServiceRecord } from "./service-records";

export interface RelaunchResult {
  relaunched: string[]; // service ids that were re-launched
  skipped: string[]; // service ids left stopped (relaunchOnResume=false)
}

/** Stand-in for service-launch.ts: "starts" a process and assigns a fresh pid. */
function launchService(service: ServiceRecord): ServiceRecord {
  return {
    ...service,
    status: "running",
    pid: `pid_${randomUUID().slice(0, 6)}`,
  };
}

export class SandboxOrchestrator {
  readonly machine: LifecycleMachine;
  private instance: SandboxInstance | null;
  private snapshotRef: SnapshotRef | null = null;

  constructor(
    private readonly provider: SnapshotProvider,
    instance: SandboxInstance,
    now: () => number = () => Date.now(),
  ) {
    this.instance = instance;
    this.machine = new LifecycleMachine("provisioning", now);
    // Provisioning completes immediately for an already-provisioned instance.
    this.machine.transition("active", "sandbox-created");
  }

  get live(): SandboxInstance | null {
    return this.instance;
  }

  get state() {
    return this.machine.state;
  }

  get currentSnapshot(): SnapshotRef | null {
    return this.snapshotRef;
  }

  /** active -> hibernating -> hibernated, snapshotting + tearing down the VM. */
  async hibernate(
    reason: "idle-timeout" | "manual-stop" = "idle-timeout",
  ): Promise<SnapshotRef> {
    if (!this.instance) {
      throw new Error("cannot hibernate: no live instance");
    }
    this.machine.transition("hibernating", reason);
    const ref = await this.provider.snapshot(this.instance);
    this.instance = null; // live VM is gone
    this.snapshotRef = ref;
    this.machine.transition("hibernated", reason);
    return ref;
  }

  /**
   * hibernated -> restoring -> active, booting a new session from the snapshot
   * and relaunching services flagged relaunchOnResume.
   */
  async resume(): Promise<{
    instance: SandboxInstance;
    relaunch: RelaunchResult;
  }> {
    if (!this.snapshotRef) {
      throw new Error("cannot resume: no snapshot");
    }
    this.machine.transition("restoring", "resume-requested");
    const instance = await this.provider.resume(this.snapshotRef);

    // Relaunch services per relaunchOnResume (the onResume hook contract).
    const relaunch: RelaunchResult = { relaunched: [], skipped: [] };
    instance.services = instance.services.map((service) => {
      if (service.relaunchOnResume) {
        relaunch.relaunched.push(service.id);
        return launchService(service);
      }
      relaunch.skipped.push(service.id);
      return service; // stays stopped, pid null
    });

    this.instance = instance;
    this.machine.transition("active", "snapshot-restored");
    return { instance, relaunch };
  }
}
