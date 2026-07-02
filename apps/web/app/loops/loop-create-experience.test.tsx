/**
 * loop-create-experience.tsx tests (#765 / F-STORY-016-001)
 *
 * F-STORY-016-001 originally claimed template action buttons had
 * per-template accessible names, but the claim was never actually shipped
 * (docs/ux-walker/fixes/F-STORY-016-001.md described work that didn't exist
 * in the code). This test is the real, first-shipped coverage for that fix:
 * every template gallery button must expose a per-template aria-label
 * ("Use <template name> template") so assistive tech doesn't see several
 * identical "Use this template" actions with no distinguishing context.
 *
 * Also covers #765's "Suggested trigger:" copy rewording (the gallery no
 * longer says "Runs:").
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getTemplateActionLabel } from "./loop-create-experience";
import { LOOP_TEMPLATES } from "./loop-templates";

describe("getTemplateActionLabel", () => {
  test("builds a per-template accessible name", () => {
    expect(getTemplateActionLabel("Review to issues")).toBe(
      "Use Review to issues template",
    );
    expect(getTemplateActionLabel("Backlog → PR")).toBe(
      "Use Backlog → PR template",
    );
  });
});

describe("LoopCreateExperience — template gallery accessibility and copy (#765)", () => {
  test("every template action button has a distinct, per-template aria-label", async () => {
    const { LoopCreateExperience } = await import("./loop-create-experience");
    const html = renderToStaticMarkup(<LoopCreateExperience />);

    for (const template of LOOP_TEMPLATES) {
      const expectedLabel = getTemplateActionLabel(template.name);
      expect(html).toContain(`aria-label="${expectedLabel}"`);
    }

    // Distinctness: as many aria-labels as templates (no duplicate label
    // shared across two different templates' buttons).
    const labels = LOOP_TEMPLATES.map((t) => getTemplateActionLabel(t.name));
    expect(new Set(labels).size).toBe(LOOP_TEMPLATES.length);
  });

  test("template card copy reads 'Suggested trigger:' not 'Runs:'", async () => {
    const { LoopCreateExperience } = await import("./loop-create-experience");
    const html = renderToStaticMarkup(<LoopCreateExperience />);

    expect(html).toContain("Suggested trigger:");
    expect(html).not.toContain(">Runs:<");
  });
});
