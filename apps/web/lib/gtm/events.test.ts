import { describe, expect, test } from "bun:test";
import { appendGtmEvent, buildGtmEventInsert } from "./events";
import { GtmError } from "./types";

describe("GTM ledger events", () => {
  test("requires stable correlation fields", () => {
    expect(() =>
      buildGtmEventInsert({
        userId: "user-1",
        requestId: "",
        eventName: "gtm.account.created",
        entityKind: "account",
        entityId: "account-1",
        status: "succeeded",
      }),
    ).toThrow(GtmError);
  });

  test("redacts sensitive payload fields before insert", () => {
    const event = buildGtmEventInsert({
      userId: "user-1",
      requestId: "req-1",
      eventName: "gtm.touchpoint.recorded",
      entityKind: "touchpoint",
      entityId: "touchpoint-1",
      status: "succeeded",
      payload: {
        subject: "Hello",
        emailBody: "secret customer content",
        nested: { apiKey: "sk-secret" },
      },
    });

    expect(event.payload).toMatchObject({
      subject: "Hello",
      emailBody: expect.stringContaining("[redacted:"),
      nested: { apiKey: expect.stringContaining("[redacted:") },
    });
    expect(event.redactionStatus).toBe("redacted");
  });

  test("throws a typed error when the append writer returns no row", async () => {
    await expect(
      appendGtmEvent(
        { insertEvent: async () => null },
        {
          userId: "user-1",
          requestId: "req-1",
          eventName: "gtm.account.created",
          entityKind: "account",
          entityId: "account-1",
          status: "succeeded",
        },
      ),
    ).rejects.toMatchObject({ kind: "ledger_append_failed" });
  });
});
