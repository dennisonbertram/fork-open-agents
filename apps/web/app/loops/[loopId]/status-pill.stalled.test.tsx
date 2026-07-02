/**
 * status-pill.stalled.test.tsx (#767)
 *
 * `stalled` must render as an amber pill (matching failed/running-style
 * urgency), never the neutral gray used for unrecognized statuses — a
 * stalled run needs attention, it isn't an intentional pause.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusPill } from "./status-pill";

describe("StatusPill stalled styling (#767)", () => {
  test("renders stalled with amber classes, not the neutral gray fallback", () => {
    const html = renderToStaticMarkup(<StatusPill status="stalled" />);
    expect(html).toContain("amber");
    expect(html).not.toContain("bg-muted/40");
  });
});
