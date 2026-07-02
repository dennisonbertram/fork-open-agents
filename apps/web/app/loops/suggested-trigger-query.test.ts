import { describe, expect, test } from "bun:test";
import {
  appendSuggestedTriggerParams,
  decodeSuggestedTriggerParams,
} from "./suggested-trigger-query";

describe("appendSuggestedTriggerParams", () => {
  test("returns the path unchanged when spec is undefined", () => {
    expect(
      appendSuggestedTriggerParams("/loops/loop-1/builder", undefined),
    ).toBe("/loops/loop-1/builder");
  });

  test("encodes a schedule.cron spec", () => {
    const result = appendSuggestedTriggerParams("/loops/loop-1/builder", {
      kind: "schedule.cron",
      schedule: "0 2 * * *",
    });
    expect(result).toContain("suggestedTriggerKind=schedule.cron");
    expect(result).toContain("suggestedTriggerSchedule=0+2+*+*+*");
  });

  test("encodes an event-kind spec without a schedule param", () => {
    const result = appendSuggestedTriggerParams("/loops/loop-1/builder", {
      kind: "github.pull_request",
    });
    expect(result).toContain("suggestedTriggerKind=github.pull_request");
    expect(result).not.toContain("suggestedTriggerSchedule");
  });
});

describe("decodeSuggestedTriggerParams", () => {
  test("round-trips a schedule.cron spec", () => {
    const params = new URLSearchParams();
    params.set("suggestedTriggerKind", "schedule.cron");
    params.set("suggestedTriggerSchedule", "0 2 * * *");
    expect(decodeSuggestedTriggerParams(params)).toEqual({
      kind: "schedule.cron",
      schedule: "0 2 * * *",
    });
  });

  test("round-trips an event-kind spec", () => {
    const params = new URLSearchParams();
    params.set("suggestedTriggerKind", "github.pull_request");
    expect(decodeSuggestedTriggerParams(params)).toEqual({
      kind: "github.pull_request",
    });
  });

  test("returns undefined when no kind param is present", () => {
    expect(decodeSuggestedTriggerParams(new URLSearchParams())).toBeUndefined();
  });

  test("returns undefined for an unrecognized kind", () => {
    const params = new URLSearchParams();
    params.set("suggestedTriggerKind", "webhook.error");
    expect(decodeSuggestedTriggerParams(params)).toBeUndefined();
  });

  test("returns undefined for schedule.cron with a missing schedule param", () => {
    const params = new URLSearchParams();
    params.set("suggestedTriggerKind", "schedule.cron");
    expect(decodeSuggestedTriggerParams(params)).toBeUndefined();
  });
});
