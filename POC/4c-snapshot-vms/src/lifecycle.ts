// Hibernate/wake lifecycle state machine.
//
// Mirrors the REAL state union in apps/web/lib/sandbox/lifecycle.ts:
//
//   export type SandboxLifecycleState =
//     | "provisioning" | "active" | "hibernating"
//     | "hibernated" | "restoring" | "archived" | "failed";
//
// The production `lifecycle.ts` calls its resuming state "restoring"; the POC
// briefing calls it "resuming". They are the same state — we expose BOTH names
// as an alias so the machine matches production exactly while still satisfying
// the briefing's `provisioning -> active -> hibernating -> hibernated ->
// resuming -> active` path.
//
// The production model maps onto the Vercel two-level sandbox/session model
// (https://vercel.com/docs/sandbox/concepts/persistent-sandboxes):
//   - "active"      = a live session is running inside the named sandbox
//   - "hibernating" = stop() in flight; SDK is snapshotting the filesystem
//   - "hibernated"  = no session; only the snapshot + durable name survive
//   - "restoring"   = a new session is booting from the snapshot
// In production the orchestrator (evaluateSandboxLifecycle) drives
// active -> hibernating -> hibernated; the resume path (-> restoring -> active)
// is driven on the next user request via connectSandbox + buildActiveLifecycleUpdate.

export type SandboxLifecycleState =
  | "provisioning"
  | "active"
  | "hibernating"
  | "hibernated"
  | "restoring"
  | "archived"
  | "failed";

// Briefing alias: "resuming" === production "restoring".
export const RESUMING: Extract<SandboxLifecycleState, "restoring"> = "restoring";

export type SandboxLifecycleReason =
  | "sandbox-created"
  | "timeout-extended"
  | "snapshot-restored"
  | "reconnect"
  | "manual-stop"
  | "status-check-overdue"
  // POC-local reasons that name the trigger in the transition log:
  | "idle-timeout"
  | "resume-requested"
  | "archive-requested";

export interface LifecycleTransition {
  from: SandboxLifecycleState;
  to: SandboxLifecycleState;
  reason: SandboxLifecycleReason;
  at: number;
}

// Allowed transitions. Anything not listed here throws — this is what makes the
// "did the machine move correctly" assertion meaningful rather than cosmetic.
const ALLOWED: Record<SandboxLifecycleState, SandboxLifecycleState[]> = {
  provisioning: ["active", "failed"],
  active: ["hibernating", "archived", "failed"],
  hibernating: ["hibernated", "active", "failed"], // active = aborted hibernation (active stream arrived)
  hibernated: ["restoring", "archived", "failed"],
  restoring: ["active", "failed"],
  archived: [],
  failed: ["restoring", "archived"], // failure is recoverable via a fresh resume attempt
};

export class LifecycleMachine {
  private _state: SandboxLifecycleState;
  private readonly log: LifecycleTransition[] = [];
  private readonly now: () => number;

  constructor(
    initial: SandboxLifecycleState = "provisioning",
    now: () => number = () => Date.now(),
  ) {
    this._state = initial;
    this.now = now;
  }

  get state(): SandboxLifecycleState {
    return this._state;
  }

  get transitions(): readonly LifecycleTransition[] {
    return this.log;
  }

  canTransition(to: SandboxLifecycleState): boolean {
    return ALLOWED[this._state].includes(to);
  }

  transition(to: SandboxLifecycleState, reason: SandboxLifecycleReason): void {
    if (!this.canTransition(to)) {
      throw new Error(
        `Illegal lifecycle transition: ${this._state} -> ${to} (reason=${reason}). ` +
          `Allowed from ${this._state}: [${ALLOWED[this._state].join(", ")}]`,
      );
    }
    const transition: LifecycleTransition = {
      from: this._state,
      to,
      reason,
      at: this.now(),
    };
    this.log.push(transition);
    this._state = to;
  }

  /** Human-readable transition trail, e.g. "provisioning -> active -> hibernating". */
  trail(): string {
    if (this.log.length === 0) return this._state;
    const parts = [this.log[0]?.from ?? this._state];
    for (const t of this.log) parts.push(t.to);
    return parts.join(" -> ");
  }
}
