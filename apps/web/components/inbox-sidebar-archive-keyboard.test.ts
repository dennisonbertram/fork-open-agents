import { describe, expect, test } from "bun:test";

const source = await Bun.file(`${import.meta.dir}/inbox-sidebar.tsx`).text();

describe("inbox sidebar archive dialog keyboard behavior", () => {
  test("focuses the archive submit button so Return confirms the modal", () => {
    expect(source).toContain("archiveSubmitButtonRef");
    expect(source).toContain("onOpenAutoFocus={(event) => {");
    expect(source).toContain("event.preventDefault();");
    expect(source).toContain("archiveSubmitButtonRef.current?.focus();");
    expect(source).toContain(
      '<Button ref={archiveSubmitButtonRef} type="submit">',
    );
  });
});
