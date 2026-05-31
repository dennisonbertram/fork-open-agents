// POC 4b — copy of the REAL ManagedRuntimeProfile type from
// `packages/sandbox/managed-runtime-profiles.ts`. Kept self-contained inside
// the POC so it has zero dependency on the app/package source. The shapes here
// MUST stay byte-compatible with the real type so the new profile objects can
// be pasted straight into MANAGED_RUNTIME_PROFILES with no edits.
//
// Source of truth (verified against the repo on 2026-05-31):
//   packages/sandbox/managed-runtime-profiles.ts

export type ManagedRuntimeProfileCommand = {
  id: string;
  label: string;
  description: string;
  command: string;
  timeoutMs?: number;
  required?: boolean;
};

export type ManagedRuntimeProfileSetupScript = {
  repoPath: string;
  sandboxPath: string;
  command: string;
  timeoutMs?: number;
};

export type ManagedRuntimeProfile = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  setupScript?: ManagedRuntimeProfileSetupScript;
  setupCommands: ManagedRuntimeProfileCommand[];
  verificationCommands: ManagedRuntimeProfileCommand[];
  expectedTools: string[];
  optionalTools: string[];
  defaultPorts: number[];
};
