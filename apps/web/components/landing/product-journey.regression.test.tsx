import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SignedOutHero } from "@/components/auth/signed-out-hero";

const landingDir = import.meta.dir;
const source = [
  "../auth/signed-out-hero.tsx",
  "features.tsx",
  "bento.tsx",
  "footer.tsx",
  "app-mockup.tsx",
  "feature-agent.tsx",
  "feature-sandbox.tsx",
  "feature-workflow.tsx",
]
  .map((file) => readFileSync(join(landingDir, file), "utf8"))
  .join("\n");

describe("landing product journey (#967)", () => {
  test("renders one semantic ordered journey with all four actions", () => {
    const html = renderToStaticMarkup(<SignedOutHero />);
    expect(html).toContain("<ol");
    for (const label of [
      "Connect GitHub",
      "Start a Session",
      "Create an Automation",
      "Inspect a Run",
    ]) {
      expect(html).toContain(label);
    }
  });

  test("removes unsupported absolutes and implementation-brand discovery", () => {
    for (const banned of [
      "autonomously until it's done",
      "instant restore",
      "survive anything",
      "No work is ever lost",
      "production-grade",
      "Workflow SDK",
      "agent loops",
      "background agents",
      "automatic checkpointing",
      "Reconnect to running workflows",
      "real infrastructure for real agents",
    ]) {
      expect(source).not.toContain(banned);
    }
  });

  test("every landing sign-in CTA returns to the safe GitHub step", () => {
    for (const file of ["../auth/signed-out-hero.tsx", "nav.tsx", "bento.tsx"]) {
      const value = readFileSync(join(landingDir, file), "utf8");
      expect(value).toContain('callbackUrl="/get-started?step=github&amp;next=%2Fsessions"');
    }
  });

  test("labels every simulated activity as an illustrative example", () => {
    expect(source.match(/Illustrative example/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(source).not.toMatch(/\$0\.0[02]\/m/);
  });

  test("all JavaScript animation surfaces use the reduced-motion hook", () => {
    for (const file of [
      "app-mockup.tsx",
      "feature-agent.tsx",
      "feature-sandbox.tsx",
      "feature-workflow.tsx",
    ]) {
      expect(readFileSync(join(landingDir, file), "utf8")).toContain(
        "usePrefersReducedMotion",
      );
    }
  });
});
