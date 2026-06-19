import { describe, expect, test } from "bun:test";
import {
  composeCron,
  defaultScheduleBuilderState,
  parseCron,
  type ScheduleBuilderState,
} from "./schedule-builder";

function state(overrides: Partial<ScheduleBuilderState>): ScheduleBuilderState {
  return { ...defaultScheduleBuilderState(), ...overrides };
}

describe("composeCron", () => {
  test("hourly composes minute-of-the-hour", () => {
    expect(composeCron(state({ frequency: "hourly", minute: 0 }))).toBe(
      "0 * * * *",
    );
    expect(composeCron(state({ frequency: "hourly", minute: 30 }))).toBe(
      "30 * * * *",
    );
  });

  test("daily composes minute + hour", () => {
    expect(composeCron(state({ frequency: "daily", minute: 0, hour: 9 }))).toBe(
      "0 9 * * *",
    );
    expect(
      composeCron(state({ frequency: "daily", minute: 15, hour: 23 })),
    ).toBe("15 23 * * *");
  });

  test("weekly composes minute + hour + sorted weekdays", () => {
    expect(
      composeCron(
        state({ frequency: "weekly", minute: 0, hour: 9, weekdays: [5, 1, 3] }),
      ),
    ).toBe("0 9 * * 1,3,5");
  });

  test("weekly with no weekdays falls back to Monday", () => {
    expect(
      composeCron(
        state({ frequency: "weekly", minute: 0, hour: 9, weekdays: [] }),
      ),
    ).toBe("0 9 * * 1");
  });

  test("custom returns the raw expression verbatim", () => {
    expect(
      composeCron(
        state({ frequency: "custom", customExpression: "*/5 0 * * 1-5" }),
      ),
    ).toBe("*/5 0 * * 1-5");
  });
});

describe("parseCron", () => {
  test("parses an hourly expression", () => {
    expect(parseCron("30 * * * *")).toEqual(
      state({ frequency: "hourly", minute: 30 }),
    );
  });

  test("parses a daily expression", () => {
    expect(parseCron("0 9 * * *")).toEqual(
      state({ frequency: "daily", minute: 0, hour: 9 }),
    );
  });

  test("parses a weekly expression into sorted weekdays", () => {
    expect(parseCron("0 9 * * 1,3,5")).toEqual(
      state({ frequency: "weekly", minute: 0, hour: 9, weekdays: [1, 3, 5] }),
    );
  });

  test("expands a weekday range", () => {
    expect(parseCron("0 9 * * 1-5")).toEqual(
      state({
        frequency: "weekly",
        minute: 0,
        hour: 9,
        weekdays: [1, 2, 3, 4, 5],
      }),
    );
  });

  test("maps @hourly / @daily / @weekly macros", () => {
    expect(parseCron("@hourly")).toEqual(
      state({ frequency: "hourly", minute: 0 }),
    );
    expect(parseCron("@daily")).toEqual(
      state({ frequency: "daily", minute: 0, hour: 0 }),
    );
    expect(parseCron("@weekly")).toEqual(
      state({ frequency: "weekly", minute: 0, hour: 0, weekdays: [0] }),
    );
  });

  test("round-trips compose -> parse for builder-expressible schedules", () => {
    for (const s of [
      state({ frequency: "hourly", minute: 5 }),
      state({ frequency: "daily", minute: 30, hour: 8 }),
      state({ frequency: "weekly", minute: 0, hour: 9, weekdays: [1, 4] }),
    ]) {
      expect(parseCron(composeCron(s))).toEqual(s);
    }
  });

  test("returns null for expressions the builder cannot represent", () => {
    expect(parseCron("*/5 * * * *")).toBeNull();
    expect(parseCron("0 0 1 * *")).toBeNull(); // day-of-month set
    expect(parseCron("0 0 * 6 *")).toBeNull(); // month set
    expect(parseCron("not a cron")).toBeNull();
    expect(parseCron("")).toBeNull();
  });
});
