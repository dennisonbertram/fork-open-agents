import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadinessVerdict } from "./readiness-verdict";

describe("ReadinessVerdict", () => {
  test("shows the plain-language headline for a ready status", () => {
    const html = renderToStaticMarkup(
      <ReadinessVerdict
        status="ready"
        headline="Background agents are enabled by your deployment."
      />,
    );
    expect(html).toContain("Background agents are enabled by your deployment.");
    expect(html).toContain("bg-emerald-500");
  });

  test("hides raw env-var names behind a collapsed Operator details disclosure", () => {
    const html = renderToStaticMarkup(
      <ReadinessVerdict
        status="action-needed"
        headline="Ask your admin to finish setup."
        checks={[
          {
            id: "github",
            label: "GitHub App installed",
            status: "missing",
            missing: ["GITHUB_APP_ID"],
          },
        ]}
      />,
    );
    // The end-user verdict is visible...
    expect(html).toContain("Ask your admin to finish setup.");
    expect(html).toContain("Operator details");
    // ...but the raw env-var name is NOT shown until the operator expands it.
    expect(html).not.toContain("GITHUB_APP_ID");
  });

  test("never leaks an env-var name into the end-user headline", () => {
    const html = renderToStaticMarkup(
      <ReadinessVerdict status="unavailable" headline="Managed by your workspace." />,
    );
    expect(html).not.toMatch(/[A-Z_]{6,}/); // no SCREAMING_SNAKE token in user-facing copy
    expect(html).toContain("bg-muted-foreground/50");
  });

  test("renders a resolving CTA when provided", () => {
    const html = renderToStaticMarkup(
      <ReadinessVerdict
        status="action-needed"
        headline="Connect GitHub to continue."
        action={<button type="button">Connect GitHub</button>}
      />,
    );
    expect(html).toContain("Connect GitHub");
  });

  test("uses the destructive dot for an error status", () => {
    const html = renderToStaticMarkup(
      <ReadinessVerdict status="error" headline="Can't reach the service — try again." />,
    );
    expect(html).toContain("bg-destructive");
  });
});
