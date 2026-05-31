// Local copy of the real ManagedRuntimeProfile shape from
// packages/sandbox/managed-runtime-profiles.ts. Kept here so this POC stays
// self-contained (no imports into app/package source). When this profile is
// promoted, drop the desktopProfile object into MANAGED_RUNTIME_PROFILES and
// delete this types file.

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
