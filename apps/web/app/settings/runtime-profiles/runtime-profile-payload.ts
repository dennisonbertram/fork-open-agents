/**
 * Form → payload mapper for creating/editing user_default managed runtime profiles.
 * Pure functions — no I/O, fully unit-testable.
 *
 * NOTE: normalizeCommands logic is inlined here (not imported from the "use client"
 * managed-runtime-profile-manager) so this module is safe to use in both server
 * and client contexts.
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

function normalizeCommandId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCommands(
  commands: ManagedRuntimeProfileCommand[],
  label: string,
): ManagedRuntimeProfileCommand[] {
  if (commands.length === 0) {
    throw new Error(`${label} commands must include at least one command`);
  }

  return commands.map((command, index) => {
    const normalized = {
      id: normalizeCommandId(command.id) || `${label}-${index + 1}`,
      label: command.label.trim(),
      description: command.description.trim(),
      command: command.command.trim(),
      timeoutMs: command.timeoutMs,
      required: command.required,
    };

    if (!normalized.label || !normalized.description || !normalized.command) {
      throw new Error(`${label} command ${index + 1} is missing required text`);
    }

    return normalized;
  });
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePorts(value: string): number[] {
  return parseCsv(value).map((item) => {
    const port = Number.parseInt(item, 10);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid port: ${item}`);
    }
    return port;
  });
}

/**
 * Convert form state into a validated create/update payload.
 * Throws if required list fields are empty.
 */
export function formToCreatePayload(
  form: RuntimeProfileFormState,
): RuntimeProfileCreatePayload {
  return {
    displayName: form.displayName.trim(),
    description: form.description.trim(),
    setupCommands: normalizeCommands(form.setupCommands, "setup"),
    verificationCommands: normalizeCommands(
      form.verificationCommands,
      "verification",
    ),
    expectedTools: parseCsv(form.expectedTools),
    optionalTools: parseCsv(form.optionalTools),
    defaultPorts: parsePorts(form.defaultPorts),
  };
}

/**
 * Returns true when a payload has the minimum fields required to send to the API.
 * Used by the UI to gate the Save button.
 */
export function isValidCreatePayload(
  payload: RuntimeProfileCreatePayload,
): boolean {
  return (
    payload.displayName.length > 0 &&
    payload.description.length > 0 &&
    payload.setupCommands.length > 0
  );
}

// ---------------------------------------------------------------------------
// Non-throwing form validation
// ---------------------------------------------------------------------------

export type RuntimeProfileFormFieldErrors = Partial<
  Record<
    | "displayName"
    | "description"
    | "setupCommands"
    | "verificationCommands"
    | "defaultPorts",
    string
  >
>;

export type ValidateCreateFormResult =
  | { ok: true; payload: RuntimeProfileCreatePayload }
  | { ok: false; fieldErrors: RuntimeProfileFormFieldErrors };

function validateCommandList(
  commands: ManagedRuntimeProfileCommand[],
  label: "setup" | "verification",
): string | null {
  if (commands.length === 0) {
    return label === "verification"
      ? "Add at least one verification command — this is how the profile proves setup worked"
      : "Add at least one setup command — this is how the profile prepares the sandbox";
  }
  for (const [index, command] of commands.entries()) {
    if (
      !command.label.trim() ||
      !command.description.trim() ||
      !command.command.trim()
    ) {
      return `${label === "verification" ? "Verification" : "Setup"} command ${
        index + 1
      } is missing a label, description, or command`;
    }
  }
  return null;
}

/**
 * Non-throwing replacement for the throw-based formToCreatePayload +
 * isValidCreatePayload pair. Returns either the validated payload or a map
 * of field-level errors — never throws, so no caller can silently swallow a
 * validation failure and leave the user with no feedback.
 */
export function validateCreateForm(
  form: RuntimeProfileFormState,
): ValidateCreateFormResult {
  const fieldErrors: RuntimeProfileFormFieldErrors = {};

  const displayName = form.displayName.trim();
  if (!displayName) {
    fieldErrors.displayName = "Name is required";
  }

  const description = form.description.trim();
  if (!description) {
    fieldErrors.description = "Description is required";
  }

  const setupError = validateCommandList(form.setupCommands, "setup");
  if (setupError) {
    fieldErrors.setupCommands = setupError;
  }

  const verificationError = validateCommandList(
    form.verificationCommands,
    "verification",
  );
  if (verificationError) {
    fieldErrors.verificationCommands = verificationError;
  }

  let defaultPorts: number[] = [];
  try {
    defaultPorts = parsePorts(form.defaultPorts);
  } catch {
    fieldErrors.defaultPorts =
      "Ports must be positive whole numbers, separated by commas (e.g. 3000, 5173)";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    payload: {
      displayName,
      description,
      setupCommands: normalizeCommands(form.setupCommands, "setup"),
      verificationCommands: normalizeCommands(
        form.verificationCommands,
        "verification",
      ),
      expectedTools: parseCsv(form.expectedTools),
      optionalTools: parseCsv(form.optionalTools),
      defaultPorts,
    },
  };
}
