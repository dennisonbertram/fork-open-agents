import { describe, expect, test } from "bun:test";
import { makeAutomationId } from "./identity";

describe("Automation identity", () => {
  test("qualifies equal source ids without collisions", () => {
    expect(makeAutomationId("background_agent", "shared")).not.toBe(
      makeAutomationId("agent_loop", "shared"),
    );
  });

  test("length-prefixes delimiter-heavy ids without ambiguity", () => {
    expect(makeAutomationId("background_agent", "a|1:b")).not.toBe(
      makeAutomationId("background_agent", "a|1:b|"),
    );
  });
});
