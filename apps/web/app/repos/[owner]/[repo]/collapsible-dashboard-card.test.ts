import { describe, expect, test } from "bun:test";
import { resolveInitialDashboardCardOpenState } from "./collapsible-dashboard-card";

describe("resolveInitialDashboardCardOpenState", () => {
  test("restores a saved collapsed preference", () => {
    expect(
      resolveInitialDashboardCardOpenState({
        storedState: "collapsed",
        viewportWidth: 1440,
      }),
    ).toBe(false);
  });

  test("restores a saved expanded preference on narrow viewports", () => {
    expect(
      resolveInitialDashboardCardOpenState({
        storedState: "expanded",
        viewportWidth: 390,
      }),
    ).toBe(true);
  });

  test("defaults to collapsed below the md breakpoint with no preference", () => {
    expect(
      resolveInitialDashboardCardOpenState({
        storedState: null,
        viewportWidth: 767,
      }),
    ).toBe(false);
  });

  test("defaults to expanded at and above the md breakpoint", () => {
    expect(
      resolveInitialDashboardCardOpenState({
        storedState: null,
        viewportWidth: 768,
      }),
    ).toBe(true);
  });

  test("keeps first render expanded when viewport data is unavailable", () => {
    expect(
      resolveInitialDashboardCardOpenState({
        storedState: null,
        viewportWidth: null,
      }),
    ).toBe(true);
  });

  test("ignores unrecognized stored values", () => {
    expect(
      resolveInitialDashboardCardOpenState({
        storedState: "open-ish",
        viewportWidth: 390,
      }),
    ).toBe(false);
  });
});
