/**
 * Tests for the SkillEditorDialog rate-limited generate-draft error copy.
 *
 * Slice #20: display retryAfterSeconds in rate-limited error copy.
 */

import {
  act,
  fireEvent,
  registerDomTestHooks,
  render,
  userClick,
  waitFor,
  within,
} from "@/tests/dom";

import { beforeEach, describe, expect, mock, test } from "bun:test";

registerDomTestHooks();

// --- Mocks -------------------------------------------------------------------

const toastSuccess = mock((_message: string) => undefined);
const toastError = mock((_message: string) => undefined);

mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const fetchResult = {
  ok: false,
  status: 429,
  json: async () => ({
    error: "Too many requests",
    errorKind: "rate_limited",
    retryAfterSeconds: 12,
  }),
};

const globalFetch = mock(async (_url: string, _opts?: unknown) => fetchResult);
// @ts-expect-error -- override global fetch for test
global.fetch = globalFetch;

const dialogPromise = import("./skill-editor-dialog");

// --- Helpers -----------------------------------------------------------------

function typeIntoTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;

  textarea.focus();
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  fireEvent.keyUp(textarea, { key: value.slice(-1) || "a" });
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

// --- Tests -------------------------------------------------------------------

describe("SkillEditorDialog -- rate-limited generate draft", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
    globalFetch.mockClear();
  });

  test("shows retry delay in toast when the generate endpoint is rate-limited", async () => {
    const { SkillEditorDialog } = await dialogPromise;

    const { baseElement } = render(
      <SkillEditorDialog
        open={true}
        onOpenChange={() => undefined}
        editingSkill={null}
        isSaving={false}
        onSubmit={async () => true}
      />,
    );

    const q = within(baseElement);

    const promptTextarea = q.getByPlaceholderText(
      /e\.g\. Review a React component/i,
    ) as HTMLTextAreaElement;

    await act(async () => {
      typeIntoTextarea(promptTextarea, "Generate a code review skill");
    });

    await userClick(q.getByRole("button", { name: "Generate draft" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });

    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("try again in 12s"),
    );
  });
});
