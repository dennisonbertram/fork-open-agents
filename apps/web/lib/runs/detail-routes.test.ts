import { describe, expect, test } from "bun:test";
import {
  canonicalRunDetailUrl,
  legacyBackgroundRunDetailUrl,
  legacyLoopRunDetailUrl,
} from "./detail-routes";

describe("canonical Run detail routes", () => {
  test("source-qualifies and safely encodes background-agent and loop ids", () => {
    expect(canonicalRunDetailUrl("background_agent", "run/one")).toBe(
      "/runs/background-agent/run%2Fone",
    );
    expect(canonicalRunDetailUrl("agent_loop", "run/two")).toBe(
      "/runs/loop/run%2Ftwo",
    );
  });

  test("keeps legacy deep-link shapes available during the additive route slice", () => {
    expect(legacyBackgroundRunDetailUrl("run/one")).toBe(
      "/background-runs/run%2Fone",
    );
    expect(legacyLoopRunDetailUrl("loop/one", "run/two")).toBe(
      "/loops/loop%2Fone/runs/run%2Ftwo",
    );
  });
});
