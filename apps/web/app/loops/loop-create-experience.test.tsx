import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

mock.module("sonner", () => ({
  toast: { error: () => undefined, success: () => undefined },
}));

const modulePromise = import("./loop-create-experience");

describe("LoopCreateExperience", () => {
  test("template actions include the template name for accessible disambiguation", async () => {
    const { getTemplateActionLabel, LoopCreateExperience } =
      await modulePromise;
    const html = renderToStaticMarkup(<LoopCreateExperience />);

    expect(getTemplateActionLabel("Review to issues")).toBe(
      "Use Review to issues template",
    );
    expect(html).toContain('aria-label="Use Review to issues template"');
    expect(html).toContain('aria-label="Use Backlog → PR template"');
  });
});
