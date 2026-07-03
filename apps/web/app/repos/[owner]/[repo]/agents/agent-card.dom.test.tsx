/**
 * DOM-interaction tests for AgentCard — the click/fetch/accessible-feedback
 * contract that renderToStaticMarkup-based string matching cannot express.
 * See agent-card.test.tsx for the rest of the status-matrix coverage.
 *
 * BT-167-006: Run now dispatches to the test/dispatch route and routes to
 *             /background-runs/:runId on success; surfaces role="alert"
 *             feedback on failure.
 * BT-167-007: Pause/Resume fires PATCH with only {status: "..."} (config
 *             preserved) and refreshes the router on success.
 *
 * Naming convention: `*.dom.test.tsx` opts a file into the happy-dom
 * environment via the first import below (@/tests/dom). This must remain
 * the FIRST import in any DOM-interaction test file — the registrator has to
 * run before React/@testing-library/react/next modules are evaluated.
 */

import {
  registerDomTestHooks,
  render,
  userClick,
  waitFor,
  within,
} from "@/tests/dom";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { makeAgent } from "./agent-card.fixtures";

// MUST be called at this file's own top level — see the header comment in
// apps/web/tests/dom/index.ts for why `afterEach(cleanup)` otherwise
// silently no-ops under CI's pinned Bun 1.2.14, leaking DOM nodes across
// tests in this file.
registerDomTestHooks();

// --- Mocks -------------------------------------------------------------------

const push = mock((_url: string) => undefined);
const refresh = mock(() => undefined);
const mutate = mock(async () => undefined);

let fetchResult: {
  ok: boolean;
  json: () => Promise<unknown>;
} = {
  ok: true,
  json: async () => ({ runIds: ["run-123"], enabled: true }),
};

mock.module("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

mock.module("swr", () => ({
  default: () => ({
    data: undefined,
    error: null,
    isLoading: false,
    mutate,
  }),
}));

const globalFetch = mock(async (_url: string, _opts?: unknown) => fetchResult);
// @ts-expect-error — override global fetch for test
global.fetch = globalFetch;

const cardModulePromise = import("./agent-card");

describe("AgentCard — DOM interaction (BT-167-006, BT-167-007)", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    mutate.mockClear();
    globalFetch.mockClear();
    fetchResult = {
      ok: true,
      json: async () => ({ runIds: ["run-123"], enabled: true }),
    };
  });

  test("BT-167-006: Run now dispatches to the test route and routes to the run", async () => {
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();

    const { container } = render(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );
    const { getByRole } = within(container);

    await userClick(getByRole("button", { name: /run now/i }));

    expect(globalFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = globalFetch.mock.calls[0] as [
      string,
      { method: string },
    ];
    expect(url).toBe("/api/background-agents/agent-1/test");
    expect(opts.method).toBe("POST");

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/background-runs/run-123");
    });
  });

  test("BT-167-006: failed dispatch surfaces role=alert feedback", async () => {
    fetchResult = {
      ok: false,
      json: async () => ({ error: "Sandbox quota exceeded" }),
    };
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent();

    const { container } = render(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );
    const { getByRole, findByRole } = within(container);

    await userClick(getByRole("button", { name: /run now/i }));

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("Sandbox quota exceeded");
    expect(push).not.toHaveBeenCalled();
  });

  test('BT-167-007: Pause fires PATCH with only {status: "disabled"}', async () => {
    fetchResult = { ok: true, json: async () => ({}) };
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent(); // enabled by default

    const { container } = render(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );
    const { getByRole } = within(container);

    await userClick(getByRole("button", { name: /pause/i }));

    expect(globalFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = globalFetch.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("/api/background-agents/agent-1");
    expect(opts.method).toBe("PATCH");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({ status: "disabled" });

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  test('BT-167-007: Resume fires PATCH with only {status: "enabled"}', async () => {
    fetchResult = { ok: true, json: async () => ({}) };
    const { AgentCard } = await cardModulePromise;
    const agent = makeAgent({ status: "disabled" });

    const { container } = render(
      <AgentCard agent={agent} latestRun={null} owner="acme" repo="widgets" />,
    );
    const { getByRole } = within(container);

    await userClick(getByRole("button", { name: /resume/i }));

    const [, opts] = globalFetch.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(opts.body)).toEqual({ status: "enabled" });
  });
});
