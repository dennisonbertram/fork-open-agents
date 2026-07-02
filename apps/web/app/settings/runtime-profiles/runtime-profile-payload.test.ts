/**
 * BT-001: formToCreatePayload produces a valid insert payload from form state
 * BT-002: formToCreatePayload trims whitespace from string fields
 * BT-003: formToCreatePayload parses CSV lists for expectedTools/optionalTools/defaultPorts
 * BT-004: formToCreatePayload throws when setupCommands is empty
 * BT-005: formToCreatePayload throws when verificationCommands is empty
 * BT-006: isValidCreatePayload returns true for a well-formed payload
 * BT-007: isValidCreatePayload returns false when displayName is blank
 * BT-008: validateCreateForm returns { ok: true, payload } for a valid form
 * BT-009: validateCreateForm returns field errors for empty verification commands
 * BT-010: validateCreateForm returns field errors for empty setup commands
 * BT-011: validateCreateForm returns a field error for a blank displayName
 * BT-012: validateCreateForm returns a field error for an invalid port
 * BT-013: validateCreateForm never throws, even on maximally invalid input
 */

import { describe, expect, test } from "bun:test";
import {
  formToCreatePayload,
  isValidCreatePayload,
  validateCreateForm,
  type RuntimeProfileFormState,
} from "./runtime-profile-payload";

const BASE_COMMAND = {
  id: "cmd-1",
  label: "Install deps",
  description: "Install dependencies",
  command: "bun install",
  required: true as const,
};

function baseForm(): RuntimeProfileFormState {
  return {
    displayName: "My Profile",
    description: "A test profile",
    expectedTools: "bun, node",
    optionalTools: "git",
    defaultPorts: "3000, 8080",
    setupCommands: [{ ...BASE_COMMAND }],
    verificationCommands: [
      {
        id: "verify-1",
        label: "Verify",
        description: "Verify setup",
        command: "bun --version",
        required: true,
      },
    ],
  };
}

describe("formToCreatePayload", () => {
  // BT-001: produces valid insert payload from form state
  test("BT-001: maps form state to a complete create payload", () => {
    const payload = formToCreatePayload(baseForm());

    expect(payload.displayName).toBe("My Profile");
    expect(payload.description).toBe("A test profile");
    expect(payload.setupCommands).toHaveLength(1);
    expect(payload.verificationCommands).toHaveLength(1);
    expect(payload.expectedTools).toEqual(["bun", "node"]);
    expect(payload.optionalTools).toEqual(["git"]);
    expect(payload.defaultPorts).toEqual([3000, 8080]);
  });

  // BT-002: trims whitespace
  test("BT-002: trims whitespace from displayName and description", () => {
    const payload = formToCreatePayload({
      ...baseForm(),
      displayName: "  Trimmed Name  ",
      description: "  Trimmed Desc  ",
    });

    expect(payload.displayName).toBe("Trimmed Name");
    expect(payload.description).toBe("Trimmed Desc");
  });

  // BT-003: parses CSV lists
  test("BT-003: parses comma-separated expectedTools and optionalTools and defaultPorts", () => {
    const payload = formToCreatePayload({
      ...baseForm(),
      expectedTools: " bun , node , git ",
      optionalTools: " docker ",
      defaultPorts: " 3000 , 8080 ",
    });

    expect(payload.expectedTools).toEqual(["bun", "node", "git"]);
    expect(payload.optionalTools).toEqual(["docker"]);
    expect(payload.defaultPorts).toEqual([3000, 8080]);
  });

  // BT-004: throws when setupCommands empty
  test("BT-004: throws when setupCommands list is empty", () => {
    expect(() =>
      formToCreatePayload({ ...baseForm(), setupCommands: [] }),
    ).toThrow("setup commands must include at least one command");
  });

  // BT-005: throws when verificationCommands empty
  test("BT-005: throws when verificationCommands list is empty", () => {
    expect(() =>
      formToCreatePayload({ ...baseForm(), verificationCommands: [] }),
    ).toThrow("verification commands must include at least one command");
  });

  test("handles empty CSV fields as empty arrays", () => {
    const payload = formToCreatePayload({
      ...baseForm(),
      expectedTools: "",
      optionalTools: "  ",
      defaultPorts: "",
    });

    expect(payload.expectedTools).toEqual([]);
    expect(payload.optionalTools).toEqual([]);
    expect(payload.defaultPorts).toEqual([]);
  });
});

describe("isValidCreatePayload", () => {
  // BT-006: returns true for well-formed payload
  test("BT-006: returns true for a complete valid payload", () => {
    const payload = formToCreatePayload(baseForm());
    expect(isValidCreatePayload(payload)).toBe(true);
  });

  // BT-007: returns false when displayName is blank
  test("BT-007: returns false when displayName is blank", () => {
    const payload = formToCreatePayload(baseForm());
    expect(isValidCreatePayload({ ...payload, displayName: "" })).toBe(false);
  });

  test("returns false when description is blank", () => {
    const payload = formToCreatePayload(baseForm());
    expect(isValidCreatePayload({ ...payload, description: "" })).toBe(false);
  });

  test("returns false when setupCommands is empty", () => {
    const payload = formToCreatePayload(baseForm());
    expect(isValidCreatePayload({ ...payload, setupCommands: [] })).toBe(false);
  });
});

describe("validateCreateForm", () => {
  // BT-008: a well-formed form validates ok with a usable payload
  test("BT-008: returns ok:true with a payload for a valid form", () => {
    const result = validateCreateForm(baseForm());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.displayName).toBe("My Profile");
      expect(result.payload.verificationCommands).toHaveLength(1);
    }
  });

  // BT-009: empty verification commands produce a field-level error, not a throw
  test("BT-009: returns a fieldErrors.verificationCommands message when verification commands is empty", () => {
    const result = validateCreateForm({
      ...baseForm(),
      verificationCommands: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.verificationCommands).toContain(
        "at least one verification command",
      );
    }
  });

  // BT-010: empty setup commands produce a field-level error
  test("BT-010: returns a fieldErrors.setupCommands message when setup commands is empty", () => {
    const result = validateCreateForm({ ...baseForm(), setupCommands: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.setupCommands).toContain(
        "at least one setup command",
      );
    }
  });

  // BT-011: blank displayName produces a field-level error naming the field
  test("BT-011: returns a fieldErrors.displayName message for a blank name", () => {
    const result = validateCreateForm({ ...baseForm(), displayName: "   " });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.displayName).toBeDefined();
    }
  });

  // BT-012: an invalid port produces a field-level error instead of throwing
  test("BT-012: returns a fieldErrors.defaultPorts message for an invalid port", () => {
    const result = validateCreateForm({
      ...baseForm(),
      defaultPorts: "not-a-port",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.defaultPorts).toBeDefined();
    }
  });

  // BT-013: validateCreateForm never throws, even with every field invalid at once
  test("BT-013: does not throw for a form with every field invalid", () => {
    expect(() =>
      validateCreateForm({
        displayName: "",
        description: "",
        expectedTools: "",
        optionalTools: "",
        defaultPorts: "abc",
        setupCommands: [],
        verificationCommands: [],
      }),
    ).not.toThrow();
  });
});
