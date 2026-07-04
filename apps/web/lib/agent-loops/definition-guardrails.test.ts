/**
 * Agent Loops — definition-guardrails.ts unit tests (#879)
 *
 * Pure unit tests for extractDefinitionGuardrails: no mocks, no I/O.
 */

import { describe, expect, test } from "bun:test";
import { extractDefinitionGuardrails } from "./definition-guardrails";

describe("extractDefinitionGuardrails", () => {
  test("returns null for null snapshot", () => {
    expect(extractDefinitionGuardrails(null)).toBeNull();
  });

  test("returns null for undefined snapshot", () => {
    expect(extractDefinitionGuardrails(undefined)).toBeNull();
  });

  test("returns null for a non-object snapshot", () => {
    expect(extractDefinitionGuardrails("not-an-object")).toBeNull();
    expect(extractDefinitionGuardrails(42)).toBeNull();
  });

  test("returns null when guardrails key is missing", () => {
    expect(extractDefinitionGuardrails({ nodes: [], edges: [] })).toBeNull();
  });

  test("returns the parsed guardrails for a valid embedded object", () => {
    expect(
      extractDefinitionGuardrails({
        nodes: [],
        edges: [],
        guardrails: { maxAgentTurnsPerStep: 24 },
      }),
    ).toEqual({ maxAgentTurnsPerStep: 24 });
  });

  test("returns null for an invalid field type (strict parse failure)", () => {
    expect(
      extractDefinitionGuardrails({
        guardrails: { maxAgentTurnsPerStep: "never" },
      }),
    ).toBeNull();
  });

  test("returns null for an unknown key (strict schema rejects it)", () => {
    expect(
      extractDefinitionGuardrails({
        guardrails: { maxAgentTurnsPerStep: 24, unknownField: true },
      }),
    ).toBeNull();
  });
});
