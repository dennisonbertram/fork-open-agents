import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("./loop-create-form", () => ({
  LoopCreateForm: () => <div data-testid="loop-create-form" />,
}));

const componentModulePromise = import("./loop-create-experience");
const templatesModulePromise = import("./loop-templates");

describe("LoopCreateExperience", () => {
  test("template actions include the template name", async () => {
    const [{ LoopCreateExperience }, { LOOP_TEMPLATES }] = await Promise.all([
      componentModulePromise,
      templatesModulePromise,
    ]);

    const html = renderToStaticMarkup(<LoopCreateExperience />);

    for (const template of LOOP_TEMPLATES) {
      expect(html).toContain(`aria-label="Use ${template.name} template"`);
    }
  });
});
