import { describe, expect, test } from "bun:test";
import { getManagedBrowserSessionName } from "./browser-session-name";

describe("managed browser session names", () => {
  test("keeps agent-browser session names short", () => {
    const name = getManagedBrowserSessionName("FHRK45TuC2U1uZxzckmE4");

    expect(name).toBe("oa-FHRK45TuC2U1uZxzckmE4");
    expect(name.length).toBeLessThanOrEqual(32);
  });
});
