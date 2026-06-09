import { describe, expect, test } from "bun:test";
import {
  MODEL_ROLE_HINTS,
  deriveCostTier,
  deriveRoleHint,
} from "./model-roles";

// ---------------------------------------------------------------------------
// deriveCostTier
// ---------------------------------------------------------------------------
describe("deriveCostTier", () => {
  // BT-TIER-001: input < 1 $/M → "$"
  test("BT-TIER-001: input 0.10 → $", () => {
    expect(deriveCostTier({ input: 0.10, output: 0.40 })).toBe("$");
  });

  test("BT-TIER-001b: input 0.80 → $", () => {
    expect(deriveCostTier({ input: 0.80, output: 4.00 })).toBe("$");
  });

  // BT-TIER-002: input 1–5 $/M → "$$"
  test("BT-TIER-002: input 1.00 → $$", () => {
    expect(deriveCostTier({ input: 1.00, output: 5.00 })).toBe("$$");
  });

  test("BT-TIER-002b: input 3.00 → $$", () => {
    expect(deriveCostTier({ input: 3.00, output: 15 })).toBe("$$");
  });

  test("BT-TIER-002c: input exactly 5.00 → $$", () => {
    expect(deriveCostTier({ input: 5.00, output: 25 })).toBe("$$");
  });

  // BT-TIER-003: input > 5 $/M → "$$$"
  test("BT-TIER-003: input 15 → $$$", () => {
    expect(deriveCostTier({ input: 15, output: 75 })).toBe("$$$");
  });

  // BT-TIER-004: no cost data → undefined
  test("BT-TIER-004: undefined cost → undefined", () => {
    expect(deriveCostTier(undefined)).toBeUndefined();
  });

  // BT-TIER-005: cost with no input field → undefined
  test("BT-TIER-005: cost with no input field → undefined", () => {
    expect(deriveCostTier({ output: 5 })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deriveRoleHint
// ---------------------------------------------------------------------------
describe("deriveRoleHint", () => {
  // BT-ROLE-001: static map wins for known model IDs
  test("BT-ROLE-001: returns static hint for claude-opus-4.6", () => {
    const hint = deriveRoleHint("anthropic/claude-opus-4.6");
    expect(hint).toBe(MODEL_ROLE_HINTS["anthropic/claude-opus-4.6"]);
    expect(typeof hint).toBe("string");
    expect(hint!.length).toBeGreaterThan(0);
  });

  test("BT-ROLE-001b: returns static hint for openai/gpt-5.4", () => {
    const hint = deriveRoleHint("openai/gpt-5.4");
    expect(hint).toBe(MODEL_ROLE_HINTS["openai/gpt-5.4"]);
  });

  // BT-ROLE-002: unknown model with no cost → undefined (no phantom hints)
  test("BT-ROLE-002: unknown model with no cost data → undefined", () => {
    expect(deriveRoleHint("unknown/mystery-model")).toBeUndefined();
  });

  // BT-ROLE-003: all 8 recommended model IDs have a non-empty hint
  test("BT-ROLE-003: all recommended model IDs have a role hint in the static map", () => {
    const recommendedIds = [
      "openai/gpt-5.4",
      "openai/gpt-5.4-nano",
      "openai/gpt-5.5",
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-opus-4.6",
      "anthropic/claude-sonnet-4-6",
      "google/gemini-2.5-flash",
      "google/gemini-2.0-flash",
    ];
    for (const id of recommendedIds) {
      const hint = MODEL_ROLE_HINTS[id];
      expect(typeof hint).toBe("string");
      expect(hint.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// MODEL_ROLE_HINTS static map
// ---------------------------------------------------------------------------
describe("MODEL_ROLE_HINTS", () => {
  // BT-MAP-001: is a plain object with string keys and string values
  test("BT-MAP-001: is a Record<string, string>", () => {
    expect(typeof MODEL_ROLE_HINTS).toBe("object");
    for (const [key, val] of Object.entries(MODEL_ROLE_HINTS)) {
      expect(typeof key).toBe("string");
      expect(typeof val).toBe("string");
    }
  });

  // BT-MAP-002: has at least 6 entries
  test("BT-MAP-002: has at least 6 entries", () => {
    expect(Object.keys(MODEL_ROLE_HINTS).length).toBeGreaterThanOrEqual(6);
  });
});
