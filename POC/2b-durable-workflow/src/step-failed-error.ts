// Terminal error thrown after a step exhausts its retry budget.

export class StepFailedError extends Error {
  constructor(
    readonly stepKey: string,
    readonly attempts: number,
    readonly reason: string,
  ) {
    super(`step "${stepKey}" failed after ${attempts} attempts: ${reason}`);
    this.name = "StepFailedError";
  }
}
