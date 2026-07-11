import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveTimeline } from "./live-timeline";
import type { SerializedBackgroundEvent } from "./types";

function evt(
  over: Partial<SerializedBackgroundEvent> & { id: string; createdAt: string },
): SerializedBackgroundEvent {
  return {
    eventName: "background-agent.progress.observed",
    status: "succeeded",
    summary: null,
    payload: {},
    workflowRunId: null,
    requestId: null,
    sandboxName: null,
    redactionStatus: "passed",
    errorKind: null,
    ...over,
  } as SerializedBackgroundEvent;
}

const LONG_CMD =
  "git checkout background-agent/release-notes-agent/qu1f9tl9s6t8 2>/dev/null || git checkout -b background-agent/release-notes-agent/qu1f9tl9s6t8";

describe("LiveTimeline", () => {
  test("orders events oldest→newest so the latest is at the bottom", () => {
    const html = renderToStaticMarkup(
      <LiveTimeline
        isLive
        statusLabel="Refreshing"
        events={[
          // Intentionally passed newest-first (as the API returns them).
          evt({ id: "b", createdAt: "2026-07-05T19:38:11Z", summary: "NEWER" }),
          evt({ id: "a", createdAt: "2026-07-05T19:38:02Z", summary: "OLDER" }),
        ]}
      />,
    );
    expect(html.indexOf("OLDER")).toBeGreaterThanOrEqual(0);
    // Newest must render AFTER (later in the DOM = visually lower) the oldest.
    expect(html.indexOf("NEWER")).toBeGreaterThan(html.indexOf("OLDER"));
  });

  test("orders by monotonic sequence when present, not just createdAt", () => {
    const html = renderToStaticMarkup(
      <LiveTimeline
        isLive
        statusLabel="Refreshing"
        events={[
          // Same createdAt; sequence says SEQ5 is newer than SEQ2. Passed out
          // of order — sort must use sequence, not the arbitrary API order.
          evt({
            id: "b",
            createdAt: "2026-07-05T19:38:02Z",
            sequence: 5,
            summary: "SEQ5",
          }),
          evt({
            id: "a",
            createdAt: "2026-07-05T19:38:02Z",
            sequence: 2,
            summary: "SEQ2",
          }),
        ]}
      />,
    );
    expect(html.indexOf("SEQ5")).toBeGreaterThan(html.indexOf("SEQ2"));
  });

  test("contains overflow the long command without clipping or horizontal overflow", () => {
    const html = renderToStaticMarkup(
      <LiveTimeline
        isLive
        statusLabel="Refreshing"
        events={[
          evt({
            id: "c",
            createdAt: "2026-07-05T19:38:02Z",
            summary: `Command passed: ${LONG_CMD}`,
            payload: { command: LONG_CMD },
          }),
        ]}
      />,
    );
    // Fixed-height, internally scrollable, no horizontal overflow.
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toMatch(/max-h-\[32rem\]/);
    // Long unbreakable strings wrap instead of overflowing (break-all present),
    // and are NOT clipped with `truncate`.
    expect(html).toContain("break-all");
    expect(html).not.toContain("truncate");
    // The command content is still present in full (rendered wrapped, not
    // clipped). Assert on a substring without `>` (which HTML-escapes to &gt;).
    expect(html).toContain(
      "git checkout -b background-agent/release-notes-agent/qu1f9tl9s6t8",
    );
  });

  test("strips repeated run-level metadata per event; surfaces only anomalies + inline duration", () => {
    const html = renderToStaticMarkup(
      <LiveTimeline
        isLive
        statusLabel="Refreshing"
        events={[
          evt({
            id: "a",
            createdAt: "2026-07-05T19:38:02Z",
            summary: "step",
            workflowRunId: "wrun_X",
            sandboxName: "sbx_Y",
            requestId: "req_Z",
            redactionStatus: "passed",
            payload: { durationMs: 8456 },
          }),
          evt({
            id: "b",
            createdAt: "2026-07-05T19:38:03Z",
            summary: "leaky",
            redactionStatus: "failed",
          }),
        ]}
      />,
    );
    // Run-level constants are NOT repeated on each event (they live in the
    // Run/Debug sidebar).
    expect(html).not.toContain("workflow wrun_X");
    expect(html).not.toContain("sandbox sbx_Y");
    expect(html).not.toContain("request req_Z");
    // A "passed" redaction is noise (hidden); a non-passed one is surfaced.
    expect(html).not.toContain("redaction passed");
    expect(html).toContain("redaction failed");
    // Duration is shown inline as supplemental info, not an orphan box.
    expect(html).toContain("8456ms");
  });

  test("renders empty state when there are no events", () => {
    const html = renderToStaticMarkup(
      <LiveTimeline isLive={false} statusLabel={null} events={[]} />,
    );
    expect(html).toContain("No events recorded.");
  });
});
