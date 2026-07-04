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
      <BuilderWhatsNextNote
        loopId="loop_abc"
        dismissed={false}
        onDismiss={() => undefined}
      />,
    );

    expect(html).toMatch(/Draft/);
    expect(html).toMatch(/Activate/);
    expect(html).toMatch(/Add a trigger/);
    expect(html).toMatch(/Run now/);
    expect(html).toMatch(/Watch runs/);
  });

  test("BT-WNN-002: renders a dismiss control", () => {
    const html = renderToStaticMarkup(
      <BuilderWhatsNextNote
        loopId="loop_abc"
        dismissed={false}
        onDismiss={() => undefined}
      />,
    );

    expect(html).toMatch(/aria-label="Dismiss"/);
  });

  test("BT-WNN-003: renders nothing once dismissed", () => {
    const html = renderToStaticMarkup(
      <BuilderWhatsNextNote
        loopId="loop_abc"
        dismissed={true}
        onDismiss={() => undefined}
      />,
    );

    expect(html).toBe("");
  });

  test("BT-WNN-004: links Activate to the loop status section", () => {
    const html = renderToStaticMarkup(
      <BuilderWhatsNextNote
        loopId="loop_abc"
        dismissed={false}
        onDismiss={() => undefined}
      />,
    );

    expect(html).toMatch(
      /<a[^>]*href="\/loops\/loop_abc#loop-status-section"[^>]*>Activate<\/a>/,
    );
  });

  test("BT-WNN-005: links Add a trigger and Run now to their sections", () => {
    const html = renderToStaticMarkup(
      <BuilderWhatsNextNote
        loopId="loop_abc"
        dismissed={false}
        onDismiss={() => undefined}
      />,
    );

    expect(html).toMatch(
      /<a[^>]*href="\/loops\/loop_abc#loop-triggers-section"[^>]*>Add a trigger<\/a>/,
    );
    expect(html).toMatch(
      /<a[^>]*href="\/loops\/loop_abc#loop-run-now"[^>]*>Run now<\/a>/,
    );
  });

  test("BT-WNN-006: links Watch runs to the run history section", () => {
    const html = renderToStaticMarkup(
      <BuilderWhatsNextNote
        loopId="loop_abc"
        dismissed={false}
        onDismiss={() => undefined}
      />,
    );

    expect(html).toMatch(
      /<a[^>]*href="\/loops\/loop_abc#loop-run-history"[^>]*>Watch runs<\/a>/,
    );
  });

  test("BT-WNN-007: Draft stays plain text, not a link", () => {
    const html = renderToStaticMarkup(
      <BuilderWhatsNextNote
        loopId="loop_abc"
        dismissed={false}
        onDismiss={() => undefined}
      />,
    );

    expect(html).not.toMatch(/<a[^>]*>Draft<\/a>/);
  });
});
