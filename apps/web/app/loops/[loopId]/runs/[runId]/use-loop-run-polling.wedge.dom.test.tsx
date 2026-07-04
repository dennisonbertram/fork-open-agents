/**
 * DOM tests proving the production polling wedge (#880).
 *
 * A poll fetch that never resolves must not block subsequent ticks
 * (timeout + AbortController), and a stalled feed must surface a visible
 * "stalled" liveness kind from the hook.
 *
 * These tests mount the REAL useLoopRunPolling hook against REAL swr (not
 * mocked) with an isolated cache provider per render, and a controllable
 * fetchImpl stub. On current develop the hook ignores any options object,
 * SWR 2.4.1's refreshInterval scheduling awaits the previous revalidation
 * before scheduling the next tick, and a never-resolving fetch therefore
 * wedges polling forever — these tests fail (waitFor timeout) on develop.
 *
 * Naming convention: `*.dom.test.tsx` opts into the happy-dom environment via
 * the first import below (@/tests/dom). This must remain the FIRST import.
 */

import { registerDomTestHooks, render, waitFor } from "@/tests/dom";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SWRConfig } from "swr";
import type { GetAgentLoopRunDetailResponse } from "@/app/api/agent-loops/types";
import { useLoopRunPolling } from "./use-loop-run-polling";

registerDomTestHooks();

function makeRunDetail(runId: string): GetAgentLoopRunDetailResponse {
  return {
    run: {
      id: runId,
      loopId: "loop_123",
      userId: "user_1",
      status: "running",
      definitionSnapshot: { nodes: [], edges: [] },
      currentNodeId: "node_step1",
      currentStepRunId: "step_1",
      iterationCount: 0,
      stepCount: 1,
      context: {},
      source: "manual",
      triggerId: null,
      idempotencyKey: "idempotency-key-1",
      errorKind: null,
      errorMessage: null,
      workflowRunId: null,
      requestId: "req_1",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      finishedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    loop: {
      id: "loop_123",
      name: "Test Loop",
      repoOwner: "acme",
      repoName: "widgets",
      guardrails: { maxStepsPerRun: 50, maxIterations: 10 },
    },
    steps: [],
    events: [],
    watchdogRuns: [],
  };
}

function HungPollProbe({
  runId,
  initialData,
  stub,
}: {
  runId: string;
  initialData: GetAgentLoopRunDetailResponse;
  stub: typeof fetch;
}) {
  const result = useLoopRunPolling(runId, initialData, {
    fetchImpl: stub,
    timeoutMs: 100,
    refreshIntervalMs: 50,
    dedupingIntervalMs: 10,
    errorRetryIntervalMs: 50,
    staleAfterMs: 100,
    nowTickMs: 25,
  });
  const liveness = (result as { liveness?: { kind?: string } }).liveness;
  return <div data-liveness={liveness?.kind ?? "missing"} />;
}

let savedFetch: typeof fetch;

beforeEach(() => {
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
});

function makeHungStub() {
  const counter = { callCount: 0 };
  const signals: (AbortSignal | undefined)[] = [];
  const stub = ((_input: RequestInfo | URL, init?: RequestInit) => {
    counter.callCount++;
    signals.push(init?.signal ?? undefined);
    return new Promise<Response>(() => {
      // never resolves — simulates the production "pending forever" fetch
    });
  }) as unknown as typeof fetch;
  return { stub, counter, signals };
}

describe("useLoopRunPolling wedge fix (#880)", () => {
  test("a hung poll fetch does not wedge subsequent ticks", async () => {
    const runId = "run_wedge_a1";
    const { stub, counter } = makeHungStub();
    const initialData = makeRunDetail(runId);

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <HungPollProbe runId={runId} initialData={initialData} stub={stub} />
      </SWRConfig>,
    );

    await waitFor(() => expect(counter.callCount).toBeGreaterThanOrEqual(2), {
      timeout: 4000,
    });
  });

  test("a tick exceeding the timeout is aborted", async () => {
    const runId = "run_wedge_a2";
    const { stub, signals } = makeHungStub();
    const initialData = makeRunDetail(runId);

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <HungPollProbe runId={runId} initialData={initialData} stub={stub} />
      </SWRConfig>,
    );

    await waitFor(() => expect(signals[0]?.aborted).toBe(true), {
      timeout: 4000,
    });
  });

  test("a stalled feed surfaces staleness via the hook", async () => {
    const runId = "run_wedge_a3";
    const { stub } = makeHungStub();
    const initialData = makeRunDetail(runId);

    const { container } = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <HungPollProbe runId={runId} initialData={initialData} stub={stub} />
      </SWRConfig>,
    );

    await waitFor(
      () =>
        expect(
          container.querySelector('[data-liveness="stalled"]'),
        ).toBeTruthy(),
      { timeout: 4000 },
    );
  });
});
