// `Suspend` is thrown out of a workflow function to durably pause it at a sleep
// timer or an event waiter; the engine driver catches it and records the
// suspended state. (`StepFailedError` lives in step-failed-error.ts to satisfy
// the one-class-per-file lint rule.)

export class Suspend {
  constructor(
    readonly kind: "sleep" | "event",
    readonly stepKey: string,
  ) {}
}
