/**
 * builder-whats-next-note.tsx tests (#768)
 *
 * Behavior contract:
 *   BT-WNN-001: renders the Draft -> Activate -> Add a trigger (or Run now)
 *               -> Watch runs sequence.
 *   BT-WNN-002: is dismissible (renders a dismiss control).
 *   BT-WNN-003: returns null once dismissed.
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BuilderWhatsNextNote } from "./builder-whats-next-note";

describe("BuilderWhatsNextNote", () => {
  test("BT-WNN-001: renders the what-happens-next sequence", () => {
    const html = renderToStaticMarkup(
      <BuilderWhatsNextNote dismissed={false} onDismiss={() => undefined} />,
    );

    expect(html).toMatch(/Draft/);
    expect(html).toMatch(/Activate/);
    expect(html).toMatch(/Add a trigger/);
    expect(html).toMatch(/Run now/);
    expect(html).toMatch(/Watch runs/);
  });

  test("BT-WNN-002: renders a dismiss control", () => {
    const html = renderToStaticMarkup(
      <BuilderWhatsNextNote dismissed={false} onDismiss={() => undefined} />,
    );

    expect(html).toMatch(/aria-label="Dismiss"/);
  });

  test("BT-WNN-003: renders nothing once dismissed", () => {
    const html = renderToStaticMarkup(
      <BuilderWhatsNextNote dismissed={true} onDismiss={() => undefined} />,
    );

    expect(html).toBe("");
  });
});
