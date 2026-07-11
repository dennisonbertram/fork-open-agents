import { describe, expect, test } from "bun:test";
import {
  buildCombinedAgentReadiness,
  isAgentReadinessReady,
  type AgentReadinessResponse,
} from "./background-agent-readiness";

describe("repository-scoped background agent readiness", () => {
  test("fails closed when an otherwise-ready response omits repository access", () => {
    const incompleteResponse: AgentReadinessResponse = {
      enabled: true,
      ready: true,
      missing: [],
      checks: [],
    };

    const readiness = buildCombinedAgentReadiness(incompleteResponse);

    expect(readiness.ready).toBe(false);
    expect(isAgentReadinessReady(readiness)).toBe(false);
    expect(readiness.missing).toContain("Repository access readiness");
  });
});
