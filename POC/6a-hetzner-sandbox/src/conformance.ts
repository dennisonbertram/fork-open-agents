/**
 * COMPILE-TIME CONFORMANCE PROOF.
 *
 * Approach used (BOTH, as the task allows):
 *  1. `src/interface.ts` is a byte copy of `packages/sandbox/interface.ts`, so
 *     the self-contained POC builds without a cross-package import in its hot
 *     path. `HetznerSandbox` is typed `implements Sandbox` against that copy.
 *  2. THIS FILE additionally imports the REAL interface directly from the real
 *     package via a relative path and asserts structural compatibility, so the
 *     copy can never silently drift from the source of truth. If the real
 *     interface changes in a way HetznerSandbox does not satisfy, `tsc`
 *     (npm run typecheck:conformance) fails here.
 *
 * Run: `bun run typecheck:conformance`
 */

import type {
  ExecResult as RealExecResult,
  Sandbox as RealSandbox,
  SandboxStats as RealSandboxStats,
  SnapshotResult as RealSnapshotResult,
} from "../../../packages/sandbox/interface";
import type {
  ExecResult as CopiedExecResult,
  Sandbox as CopiedSandbox,
  SandboxStats as CopiedSandboxStats,
  SnapshotResult as CopiedSnapshotResult,
} from "./interface";
import { HetznerSandbox } from "./sandbox";

// 1) The copied interface must be assignable both ways to the real one.
//    (Bidirectional assignment == structural identity.)
const _execA: RealExecResult = {} as CopiedExecResult;
const _execB: CopiedExecResult = {} as RealExecResult;
const _snapA: RealSnapshotResult = {} as CopiedSnapshotResult;
const _snapB: CopiedSnapshotResult = {} as RealSnapshotResult;
const _statA: RealSandboxStats = {} as CopiedSandboxStats;
const _statB: CopiedSandboxStats = {} as RealSandboxStats;
const _sandA: RealSandbox = {} as CopiedSandbox;
const _sandB: CopiedSandbox = {} as RealSandbox;

// 2) A HetznerSandbox instance must satisfy the REAL Sandbox interface.
//    `satisfies` keeps the concrete type while enforcing the contract.
declare const _instance: HetznerSandbox;
const _conformsReal: RealSandbox = _instance;
const _conformsCopied = _instance satisfies CopiedSandbox;

// Reference the bindings so noUnusedLocals/lints don't strip the checks.
export const __conformance = {
  _execA,
  _execB,
  _snapA,
  _snapB,
  _statA,
  _statB,
  _sandA,
  _sandB,
  _conformsReal,
  _conformsCopied,
};
