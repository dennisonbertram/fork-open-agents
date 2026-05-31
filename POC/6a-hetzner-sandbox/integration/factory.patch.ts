/**
 * ILLUSTRATIVE, TYPE-CHECKED integration patch for the REAL provider seam.
 *
 * This file imports the REAL `Sandbox` interface and the REAL factory types
 * from `packages/sandbox/*` and demonstrates the exact change needed to wire
 * Hetzner into `connectSandbox()`. It compiles under
 * `bun run typecheck:conformance`, proving the union add + branch are
 * type-correct against the actual codebase.
 *
 * The real edit to `packages/sandbox/factory.ts`:
 *
 *   // BEFORE
 *   export type SandboxState = { type: "vercel" } & VercelState;
 *
 *   // AFTER
 *   export type SandboxState =
 *     | ({ type: "vercel" } & VercelState)
 *     | ({ type: "hetzner" } & HetznerState);
 *
 *   // and in connectSandbox():
 *   if (state.type === "hetzner") return connectHetzner(state, options);
 *   return connectVercel(state, options);
 */

import type { Sandbox } from "../../../packages/sandbox/interface";
import type { VercelState } from "../../../packages/sandbox/vercel/state";
import type { HetznerState } from "./hetzner-state";

/** The generalized discriminated union that replaces the vercel-only type. */
export type SandboxState =
  | ({ type: "vercel" } & VercelState)
  | ({ type: "hetzner" } & HetznerState);

export interface ConnectOptions {
  env?: Record<string, string>;
  githubToken?: string;
  hooks?: unknown;
  timeout?: number;
  ports?: number[];
  baseSnapshotId?: string;
  resume?: boolean;
  persistent?: boolean;
}

// Stand-ins for the real provider entrypoints (signatures match the real ones).
declare function connectVercel(
  state: { type: "vercel" } & VercelState,
  options?: ConnectOptions,
): Promise<Sandbox>;
declare function connectHetzner(
  state: { type: "hetzner" } & HetznerState,
  options?: ConnectOptions,
): Promise<Sandbox>;

/**
 * The generalized `connectSandbox` body. The discriminant makes each branch
 * narrow to the right state type — no `any`, fully type-checked.
 */
export async function connectSandboxGeneralized(
  state: SandboxState,
  options?: ConnectOptions,
): Promise<Sandbox> {
  switch (state.type) {
    case "vercel":
      return connectVercel(state, options);
    case "hetzner":
      return connectHetzner(state, options);
    default: {
      // Exhaustiveness guard — adding a new provider forces a branch here.
      const _never: never = state;
      throw new Error(`unsupported sandbox type: ${JSON.stringify(_never)}`);
    }
  }
}
