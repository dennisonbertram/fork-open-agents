/**
 * Form → payload mapper for creating/editing user_default managed runtime profiles.
 * Pure functions — no I/O, fully unit-testable.
 */

import type { ManagedRuntimeProfileCommand } from "@open-agents/sandbox/managed-runtime-profiles";

export type RuntimeProfileFormState = {
  displayName: string;
  description: string;
  expectedTools: string;
  optionalTools: string;
  defaultPorts: string;
  setupCommands: ManagedRuntimeProfileCommand[];
  verificationCommands: ManagedRuntimeProfileCommand[];
};

export type RuntimeProfileCreatePayload = {
  displayName: string;
  description: string;
  setupCommands: ManagedRuntimeProfileCommand[];
  verificationCommands: ManagedRuntimeProfileCommand[];
  expectedTools: string[];
  optionalTools: string[];
  defaultPorts: number[];
};

// Stub — will throw / return wrong values until implemented.
export function formToCreatePayload(
  _form: RuntimeProfileFormState,
): RuntimeProfileCreatePayload {
  throw new Error("Not implemented");
}

// Stub
export function isValidCreatePayload(
  _payload: RuntimeProfileCreatePayload,
): boolean {
  throw new Error("Not implemented");
}
