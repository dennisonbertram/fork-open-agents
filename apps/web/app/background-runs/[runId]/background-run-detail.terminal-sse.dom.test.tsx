import { act, registerDomTestHooks, render, waitFor } from "@/tests/dom";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { BackgroundRunDetailData } from "./types";

registerDomTestHooks();

let onTerminal: ((status: string) => void) | null = null;

mock.module("./use-background-run-event-source", () => ({
  useBackgroundRunEventSource: (options: {
    onTerminal: (status: string) => void;
  }) => {
    onTerminal = options.onTerminal;
    return { status: "live" as const };
  },
}));

mock.module("swr", () => ({
  default: <TData,>(
    _key: string | null,
    _fetcher: unknown,
    options?: { fallbackData?: TData },
  ) => ({ data: options?.fallbackData, error: null }),
}));

const initialData: BackgroundRunDetailData = {
  run: {
    id: "run-1",
    status: "running",
    source: "github",
    triggerId: "trigger-1",
    triggerKind: "github.pull_request",
    externalId: "delivery-1",
    idempotencyKey: "key-1",
    repoOwner: "acme",
    repoName: "shop",
    ref: null,
    sha: null,
    branch: null,
    prNumber: 42,
    issueNumber: null,
    deploymentUrl: null,
    outputUrl: null,
    sandboxName: null,
    requestId: null,
    workflowRunId: null,
    errorKind: null,
    errorMessage: null,
    resultSummary: null,
    createdAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:01:00.000Z",
    startedAt: "2026-07-11T10:01:00.000Z",
    finishedAt: null,
  },
  agent: {
    id: "agent-1",
    name: "Review",
    permissions: {},
    checkConfigured: false,
  },
  events: [],
  outputs: [],
};

const finalData: BackgroundRunDetailData = {
  ...initialData,
  run: {
    ...initialData.run,
    status: "succeeded",
    outputUrl: "https://github.com/acme/shop/pull/43",
    sandboxName: "sandbox-final",
    requestId: "request-final",
    workflowRunId: "workflow-final",
    finishedAt: "2026-07-11T10:02:00.000Z",
    resultSummary: {
      headline: "Run succeeded — created PR #43",
      checked: [],
      changed: ["Opened PR #43"],
      blocked: [],
      artifacts: [],
      next: [],
      warnings: [],
    },
  },
  outputs: [
    {
      id: "output-1",
      kind: "ready_pr",
      status: "created",
      url: "https://github.com/acme/shop/pull/43",
      prNumber: 43,
    },
  ],
};

const fetchDetail = mock(async () => Response.json(finalData, { status: 200 }));
const originalFetch = globalThis.fetch;
const originalSseFlag = process.env.NEXT_PUBLIC_ENABLE_BACKGROUND_RUN_SSE;

beforeAll(() => {
  process.env.NEXT_PUBLIC_ENABLE_BACKGROUND_RUN_SSE = "true";
  globalThis.fetch = fetchDetail as unknown as typeof fetch;
});

beforeEach(() => {
  fetchDetail.mockReset();
  fetchDetail.mockImplementation(async () => Response.json(finalData));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalSseFlag === undefined) {
    delete process.env.NEXT_PUBLIC_ENABLE_BACKGROUND_RUN_SSE;
  } else {
    process.env.NEXT_PUBLIC_ENABLE_BACKGROUND_RUN_SSE = originalSseFlag;
  }
});

const detailModule = import("./background-run-detail");

describe("background terminal SSE evidence", () => {
  test("revalidates the ownership-scoped REST detail and renders final evidence", async () => {
    const { BackgroundRunDetail } = await detailModule;
    const view = render(<BackgroundRunDetail initialData={initialData} />);

    expect(onTerminal).not.toBeNull();
    await act(async () => {
      onTerminal?.("succeeded");
    });

    await waitFor(() => {
      expect(fetchDetail).toHaveBeenCalledWith(
        "/api/background-agent-runs/run-1",
      );
      expect(view.getByText("Run succeeded — created PR #43")).toBeTruthy();
      expect(view.getAllByText("ready_pr").length).toBeGreaterThan(0);
      expect(view.getByText("workflow-final")).toBeTruthy();
    });
  });

  test("keeps existing evidence and surfaces a final-refresh failure", async () => {
    fetchDetail.mockRejectedValueOnce(new Error("temporary failure"));
    const { BackgroundRunDetail } = await detailModule;
    const view = render(<BackgroundRunDetail initialData={initialData} />);

    await act(async () => {
      onTerminal?.("succeeded");
    });

    await waitFor(() => {
      expect(
        view.getByText(
          "Final evidence refresh failed. Last known evidence is shown.",
        ),
      ).toBeTruthy();
      expect(view.getByText("No outputs recorded.")).toBeTruthy();
    });
  });
});
