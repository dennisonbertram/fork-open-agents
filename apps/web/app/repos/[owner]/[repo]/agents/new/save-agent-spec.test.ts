import { describe, expect, mock, test } from "bun:test";
import { saveAgentSpec } from "./save-agent-spec";

describe("saveAgentSpec (builder re-save routing)", () => {
  test("first save (no id) creates via submitNewAgent — POST", async () => {
    const submit = mock(async () => ({ ok: true as const, agentId: "a1" }));
    const update = mock(async () => ({ ok: true as const, agentId: "a1" }));

    const result = await saveAgentSpec(null, { name: "x" }, { submit, update });

    expect(result).toEqual({ ok: true, agentId: "a1" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  test("REGRESSION: re-save with an existing id updates via PATCH — never a second create", async () => {
    const submit = mock(async () => ({ ok: true as const, agentId: "a1" }));
    const update = mock(async () => ({ ok: true as const, agentId: "a1" }));

    // Simulate the builder state after a successful first create: createdAgentId
    // is set. Before the fix, handleSave always called submitNewAgent, POSTing a
    // duplicate agent and orphaning the first. The fix routes to update (PATCH).
    const result = await saveAgentSpec(
      "a1",
      { name: "renamed" },
      { submit, update },
    );

    expect(result).toEqual({ ok: true, agentId: "a1" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("a1", { name: "renamed" });
    // The critical assertion: no second create is issued.
    expect(submit).not.toHaveBeenCalled();
  });
});
