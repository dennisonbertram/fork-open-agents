import { beforeEach, describe, expect, mock, test } from "bun:test";
import { registerDomTestHooks, render, userClick, within } from "@/tests/dom";

registerDomTestHooks();

const push = mock((_href: string) => undefined);
const toastSuccess = mock((_message: string) => undefined);
const toastError = mock((_message: string) => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ push, back: () => undefined }),
}));
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
mock.module("./repo-combobox", () => ({
  RepoCombobox: () => <div data-testid="repo-combobox" />,
}));

const definition = {
  nodes: [
    { id: "start", kind: "start", label: "Start", position: { x: 0, y: 0 } },
    { id: "end", kind: "end", label: "End", position: { x: 200, y: 0 } },
  ],
  edges: [{ id: "e1", source: "start", target: "end", when: "always" }],
};
const expectedBody = JSON.stringify({
  name: "Release safely",
  description: "Durable release checks",
  repoOwner: "acme",
  repoName: "shop",
  definition,
});

let requestCount = 0;
const globalFetch = mock(async (_url: string, _options?: RequestInit) => {
  requestCount += 1;
  if (requestCount === 1) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        enabled: true,
        checks: [
          {
            id: "repo_access",
            label: "This repository",
            status: "ready",
            detail: "Ready",
            missing: [],
          },
        ],
      }),
    };
  }
  return {
    ok: true,
    status: 201,
    json: async () => ({ loop: { id: "loop-1", name: "Release safely" } }),
  };
});
// @ts-expect-error test fetch double
global.fetch = globalFetch;

const formModulePromise = import("./loop-create-form");

describe("LoopCreateForm Automation compatibility", () => {
  beforeEach(() => {
    requestCount = 0;
    push.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    globalFetch.mockClear();
  });

  test("posts the exact source payload and returns to canonical edit with query context intact", async () => {
    const { LoopCreateForm } = await formModulePromise;
    const { container } = render(
      <LoopCreateForm
        initialRepoOwner="acme"
        initialRepoName="shop"
        initialName="Release safely"
        initialDescription="Durable release checks"
        initialDefinitionText={JSON.stringify(definition)}
        redirectTo="builder"
        suggestedTriggerSpec={{
          kind: "github.pull_request",
        }}
        surface="automation"
      />,
    );

    await userClick(
      within(container).getByRole("button", {
        name: "Create multi-step Automation",
      }),
    );

    expect(globalFetch).toHaveBeenNthCalledWith(
      2,
      "/api/agent-loops",
      expect.objectContaining({ method: "POST", body: expectedBody }),
    );
    expect(push).toHaveBeenCalledWith(
      "/automations/agent-loop/loop-1/edit?suggestedTriggerKind=github.pull_request",
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      'Multi-step Automation draft "Release safely" created.',
    );
  });
});
