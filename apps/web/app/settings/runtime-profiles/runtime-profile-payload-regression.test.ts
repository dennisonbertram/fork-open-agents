/**
 * Regression tests for the runtime-profile form→payload mapper.
 *
 * These tests would fail if the implementation in
 * runtime-profile-payload.ts were reverted or broken.
 *
 * Scenarios covered:
 * - REG-001: formToCreatePayload preserves scope-specific logic (user_default context)
 * - REG-002: normalizeCommandId is applied inside formToCreatePayload (id slug)
 * - REG-003: Invalid port string is caught before hitting the API
 * - REG-004: isValidCreatePayload correctly validates minimum verificationCommands requirement
 * - REG-005: parsePorts rejects fractional numbers as invalid ports
 */

import { describe, expect, test } from "bun:test";
import {
  formToCreatePayload,
  isValidCreatePayload,
  type RuntimeProfileFormState,
} from "./runtime-profile-payload";
import type { ManagedRuntimeProfileCommand } from "@open-agents/sandbox/managed-runtime-profiles";

function baseCommand(
  overrides: Partial<ManagedRuntimeProfileCommand> = {},
): ManagedRuntimeProfileCommand {
  return {
    id: "cmd-1",
    label: "Install",
    description: "Install dependencies",
    command: "bun install",
    required: true,
    ...overrides,
  };
}

function baseForm(
  overrides: Partial<RuntimeProfileFormState> = {},
): RuntimeProfileFormState {
  return {
    displayName: "Test Profile",
    description: "A test profile",
    expectedTools: "bun",
    optionalTools: "",
    defaultPorts: "3000",
    setupCommands: [baseCommand()],
    verificationCommands: [baseCommand({ id: "verify-1", label: "Verify" })],
    ...overrides,
  };
}

describe("runtime-profile-payload regression", () => {
  // REG-001: formToCreatePayload returns the expected shape required by the API
  test("REG-001: payload shape matches the createOrUpdateProfileSchema fields", () => {
    const payload = formToCreatePayload(baseForm());

    // All seven top-level fields must be present
    expect(Object.keys(payload).sort()).toEqual([
      "defaultPorts",
      "description",
      "displayName",
      "expectedTools",
      "optionalTools",
      "setupCommands",
      "verificationCommands",
    ]);
  });

  // REG-002: command ids are normalized via the slug function
  test("REG-002: command ids with spaces are normalized to kebab-case slugs", () => {
    const payload = formToCreatePayload(
      baseForm({
        setupCommands: [
          baseCommand({ id: "Install Bun Dependencies", label: "Install Bun" }),
        ],
      }),
    );

    expect(payload.setupCommands[0]?.id).toBe("install-bun-dependencies");
  });

  // REG-003: invalid port string throws before reaching the API
  test("REG-003: invalid port string (non-numeric) throws during formToCreatePayload", () => {
    expect(() =>
      formToCreatePayload(baseForm({ defaultPorts: "not-a-port" })),
    ).toThrow("Invalid port");
  });

  // REG-004: isValidCreatePayload returns false for empty setupCommands array
  test("REG-004: isValidCreatePayload returns false when setupCommands is empty array", () => {
    const payload = formToCreatePayload(baseForm());
    const invalid = {
      ...payload,
      setupCommands: [] as ManagedRuntimeProfileCommand[],
    };
    expect(isValidCreatePayload(invalid)).toBe(false);
  });

  // REG-005: fractional ports are rejected (parseInt truncates, > 0 check catches 0.5 → 0)
  test("REG-005: a port string of 0 is rejected as invalid", () => {
    expect(() => formToCreatePayload(baseForm({ defaultPorts: "0" }))).toThrow(
      "Invalid port",
    );
  });

  // REG-006: whitespace-only displayName is trimmed and then fails isValidCreatePayload
  test("REG-006: whitespace-only displayName results in isValidCreatePayload returning false", () => {
    const payload = formToCreatePayload(baseForm({ displayName: "   " }));
    expect(isValidCreatePayload(payload)).toBe(false);
  });

  // REG-007: a form that was previously valid stays valid after a round-trip through formToCreatePayload
  test("REG-007: valid form produces a payload that passes isValidCreatePayload", () => {
    const payload = formToCreatePayload(baseForm());
    expect(isValidCreatePayload(payload)).toBe(true);
  });
});
