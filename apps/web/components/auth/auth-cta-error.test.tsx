/**
 * Tests for the shared AuthCtaError presentational component (#786).
 *
 * BT-786-020: Renders the given message and a "Try again" retry control.
 * BT-786-021: Renders an aria-live="polite" alert region (not relying on
 *             color alone) and the retry control is a real <button>
 *             (keyboard reachable).
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthCtaError } from "./auth-cta-error";

describe("AuthCtaError (#786)", () => {
  test("BT-786-020: renders the message and a Try again control", () => {
    const html = renderToStaticMarkup(
      <AuthCtaError
        message="Sign-in didn't start. Try again."
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Sign-in didn&#x27;t start. Try again.");
    expect(html).toContain("Try again");
  });

  test("BT-786-021: renders an aria-live polite alert with a real button control", () => {
    const html = renderToStaticMarkup(
      <AuthCtaError
        message="Couldn't connect GitHub. Try again."
        onRetry={() => {}}
      />,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*>[\s\S]*Try again/);
  });
});
