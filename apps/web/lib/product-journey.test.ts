import { describe, expect, test } from "bun:test";
import { PRODUCT_JOURNEY } from "./product-journey";

describe("shared product journey (#967)", () => {
  test("uses the exact ordered presentation contract and canonical routes", () => {
    expect(PRODUCT_JOURNEY.map((step) => step.label)).toEqual([
      "Connect GitHub",
      "Start a Session",
      "Create an Automation",
      "Inspect a Run",
    ]);
    expect(PRODUCT_JOURNEY.map((step) => step.href)).toEqual([
      "/get-started?step=github&next=%2Fsessions",
      "/sessions",
      "/automations",
      "/runs",
    ]);
    expect(PRODUCT_JOURNEY[1].description).toMatch(/durable.*repository.*branch.*sandbox/i);
    expect(PRODUCT_JOURNEY[2].description).toMatch(/manual.*github.*schedule.*permissions.*readiness/i);
    expect(PRODUCT_JOURNEY[3].description).toMatch(/status.*trigger.*evidence.*recovery/i);
  });
});
