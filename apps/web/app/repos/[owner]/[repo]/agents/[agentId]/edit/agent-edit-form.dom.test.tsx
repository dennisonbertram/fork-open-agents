/**
 * DOM-interaction tests for AgentEditForm's "Run a test" skip feedback.
 *
 * #861: every matched:0 outcome of the manual "Run a test" dispatch must be
 * explained to the user via a prominent role="alert" message with an
 * actionable next step. This surface duplicates new-agent-builder.tsx's
 * ManualTestResponse handling, so it gets the same fix and the same test
 * shape (see new-agent-builder.dom.test.tsx).
 *
 * Naming convention: `*.dom.test.tsx` opts a file into the happy-dom
 * environment via the first import below (@/tests/dom). This must remain
 * the FIRST import in any DOM-interaction test file.
 */

import { registerDomTestHooks, render, userClick, within } from "@/tests/dom";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { BackgroundAgentWithTriggers } from "@/lib/background-agents/store";

registerDomTestHooks();

// --- Mocks -------------------------------------------------------------------

const push = mock((_url: string) => undefined);
const refresh = mock(() => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const toastSuccess = mock((_message: string) => undefined);
const toastError = mock((_message: string) => undefined);

mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

mock.module("../../agent-spec-editor", () => ({
  AgentSpecEditor: ({
    onRunTest,
    testAlert,
  }: {
    onRunTest: () => void | Promise<void>;
    testAlert?: string | null;
  }) => (
    <>
      <button onClick={() => void onRunTest()} type="button">
        Run a test
      </button>
      {testAlert ? <div role="alert">{testAlert}</div> : null}
    </>
  ),
}));

let fetchResult: { ok: boolean; json: () => Promise<unknown> } = {
  ok: true,
  json: async () => ({ enabled: true, matched: 1, runIds: ["run-9"] }),
};

const globalFetch = mock(async (_url: string, _opts?: unknown) => fetchResult);
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

const formPromise = import("./agent-edit-form");

const agent = {
  id: "agent-1",
  status: "enabled",
  triggers: [],
} as unknown as BackgroundAgentWithTriggers;

describe("AgentEditForm — run-test skip feedback (#861)", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    globalFetch.mockClear();
  });

  test.each([
    [
      "agent_disabled",
      "This agent is disabled — enable it above, then run the test again.",
    ],
    [
      "no_enabled_trigger",
      "This agent has no enabled trigger to test — add or enable one first.",
    ],
    [
      "repo_not_allowlisted",
      "This repository isn't allowlisted for background agents — check Background agent settings.",
    ],
  ])(
    "skipReason %s renders a prominent alert with the mapped copy",
    async (skipReason, expectedCopy) => {
      const { AgentEditForm } = await formPromise;

      fetchResult = {
        ok: true,
        json: async () => ({
          enabled: true,
          matched: 0,
          created: 0,
          duplicates: 0,
          runIds: [],
          skipReason,
        }),
      };

      const { container } = render(
        <AgentEditForm agent={agent} owner="acme" repo="widgets" />,
      );
      const q = within(container);

      await userClick(q.getByRole("button", { name: /run a test/i }));

      const alert = await q.findByRole("alert");
      expect(alert.textContent).toContain(expectedCopy);
      expect(push).not.toHaveBeenCalled();
    },
  );
});
