// POC 4b — the four NEW managed runtime profiles, ready to register into the
// real `MANAGED_RUNTIME_PROFILES` array in
// `packages/sandbox/managed-runtime-profiles.ts`.

import { dockerProfile } from "./docker";
import { goProfile } from "./go";
import { pythonProfile } from "./python";
import { rustProfile } from "./rust";
import type { ManagedRuntimeProfile } from "./types";

export { dockerProfile, goProfile, pythonProfile, rustProfile };
export type {
  ManagedRuntimeProfile,
  ManagedRuntimeProfileCommand,
} from "./types";

export const NEW_MANAGED_RUNTIME_PROFILES: ManagedRuntimeProfile[] = [
  pythonProfile,
  goProfile,
  rustProfile,
  dockerProfile,
];
