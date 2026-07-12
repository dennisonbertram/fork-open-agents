import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BackgroundRunDetailData } from "./background-run-detail";

mock.module("swr", () => ({
  default: <TData,>(
    _key: string,
    _fetcher: unknown,
    options?: { fallbackData?: TData },
  ) => ({
    data: options?.fallbackData,
    error: null,
  }),
}));

const componentModulePromise = import("./background-run-detail");

function detailData(
  overrides: Partial<BackgroundRunDetailData> = {},
): BackgroundRunDetailData {
  return {
    run: {
      id: "run_123",
      status: "running",
      source: "github",
      triggerId: "trigger-1",
      triggerKind: "github.pull_request",
      externalId: "delivery-123",
      idempotencyKey: "agent-1:trigger-1:delivery-123",
      repoOwner: "acme",
      repoName: "widgets",
      ref: "refs/pull/7/head",
      sha: "abc123",
      branch: "feature/widgets",
      prNumber: 7,
      issueNumber: null,
      deploymentUrl: null,
      outputUrl: "https://github.com/acme/widgets/pull/42",
      sandboxName: "background_agent_run_123",
      requestId: "req_123",
      workflowRunId: "workflow-1",
      errorKind: null,
      errorMessage: null,
      createdAt: "2026-05-27T12:00:00.000Z",
      updatedAt: "2026-05-27T12:01:00.000Z",
      startedAt: "2026-05-27T12:01:00.000Z",
      finishedAt: null,
    },
    agent: {
      id: "agent-1",
      name: "Smoke fixer",
      permissions: {
        github: {
          contents: "write",
          pullRequests: "write",
          checks: "read",
        },
      },
      checkConfigured: true,
    },
    events: [
      {
        id: "event-1",
        eventName: "background-agent.check.completed",
        status: "succeeded",
        summary: "Command passed: required_check.",
        workflowRunId: "workflow-1",
        sandboxName: "background_agent_run_123",
        requestId: "req_123",
        errorKind: null,
        redactionStatus: "passed",
        payload: {
          commandLabel: "required_check",
          commandHash: "a".repeat(64),
          durationMs: 1234,
          stdout: "all tests passed",
        },
        createdAt: "2026-05-27T12:02:00.000Z",
      },
    ],
    outputs: [
      {
        id: "output-1",
        kind: "ready_pr",
        status: "created",
        url: "https://github.com/acme/widgets/pull/42",
        prNumber: 42,
      },
    ],
    ...overrides,
  };
}

describe("BackgroundRunDetail", () => {
  test("renders proof strip, live timeline evidence, and output actions", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={detailData()} />,
    );

    expect(html).toContain("Background run");
    expect(html).toContain("Status");
    expect(html).toContain("github.pull_request");
    expect(html).toContain("acme/widgets");
    expect(html).toContain("abc123");
    expect(html).toContain("background_agent_run_123");
    expect(html).toContain("Permissions");
    expect(html).toContain("contents:write, pullRequests:write, checks:read");
    expect(html).toContain("Checks");
    expect(html).toContain("succeeded");
    expect(html).toContain("Output");
    expect(html).toContain("ready_pr · created");
    expect(html).toContain("Duration");
    expect(html).toContain("Running");
    expect(html).toContain("Live timeline");
    expect(html).toContain("Refreshing");
    expect(html).toContain("Command passed: required_check.");
    expect(html).toContain("background-agent.check.completed");
    expect(html).toContain("required_check");
    expect(html).toContain("1234ms");
    expect(html).toContain("all tests passed");
    // Run-level metadata (workflow run, request id, sandbox) is shown ONCE in
    // the Run/Debug sidebar + proof strip, not repeated on every timeline event.
    expect(html).toContain("workflow-1");
    expect(html).toContain("background_agent_run_123");
    expect(html).toContain("Debug");
    expect(html).toContain("agent-1:trigger-1:delivery-123");
    expect(html).toContain("delivery-123");
    expect(html).toContain("req_123");
    expect(html).toContain("PR #7");
    expect(html).toContain("https://github.com/acme/widgets/pull/42");
    expect(html).toContain("#42");
    expect(html).toContain("ready_pr");
  });

  // BT-UI-001: summary section renders above timeline when summary is present (#163)
  test("BT-UI-001: summary section renders above raw timeline when resultSummary present", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;
    const dataWithSummary = {
      ...detailData(),
      run: {
        ...detailData().run,
        resultSummary: {
          headline: "Run succeeded — created ready_pr #42",
          checked: ["bun --bun run ci passed"],
          changed: [],
          blocked: [],
          artifacts: [
            {
              kind: "ready_pr",
              label: "PR #42",
              url: "https://github.com/acme/widgets/pull/42",
              prNumber: 42,
            },
          ],
          next: [],
          warnings: [],
        },
      },
    };

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={dataWithSummary} />,
    );

    // Summary section must exist
    expect(html).toContain("Run summary");
    expect(html).toContain("Run succeeded — created ready_pr #42");
    // Summary must appear before (earlier position in HTML) the raw timeline
    const summaryPos = html.indexOf("Run summary");
    const timelinePos = html.indexOf("Live timeline");
    expect(summaryPos).toBeGreaterThanOrEqual(0);
    expect(timelinePos).toBeGreaterThan(summaryPos);
  });

  // Regression: run-level ids backfill from stream events into the sidebar when
  // the run object hasn't been populated yet (they were removed from per-event
  // metadata to cut noise, so the sidebar must pick them up).
  test("backfills workflow/sandbox/request ids from events when run fields are null", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;
    const base = detailData();
    const data = {
      ...base,
      run: {
        ...base.run,
        workflowRunId: null,
        sandboxName: null,
        requestId: null,
      },
      events: [
        {
          ...base.events[0],
          workflowRunId: "wrun_live",
          sandboxName: "sbx_live",
          requestId: "req_live",
        },
      ],
    };

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={data} />,
    );

    // The live identifiers appear (from the sidebar/proof-strip backfill), even
    // though the run object's own fields were null.
    expect(html).toContain("wrun_live");
    expect(html).toContain("sbx_live");
    expect(html).toContain("req_live");
  });

  // BT-UI-002: summary section is absent / gracefully absent when no summary (#163)
  test("BT-UI-002: no summary section when resultSummary is null", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={detailData()} />,
    );

    // "Summary unavailable" shown or summary section absent — either is acceptable
    // but we must NOT show a null/undefined dump
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("undefined");
  });

  // Regression (#798): a row persisted before the warnings[] field shipped
  // has no `warnings` key at all in its stored jsonb — the component must
  // not crash reading `.length` off `undefined`.
  test("REGRESSION (#798): resultSummary without a warnings key does not throw", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;
    const legacySummary = {
      ...detailData(),
      run: {
        ...detailData().run,
        resultSummary: {
          headline: "Run succeeded — no output created",
          checked: [],
          changed: ["no output created"],
          blocked: [],
          artifacts: [],
          next: [],
          // Intentionally omitted: `warnings` — simulates a pre-#798 row.
        } as unknown as BackgroundRunDetailData["run"]["resultSummary"],
      },
    };

    expect(() =>
      renderToStaticMarkup(<BackgroundRunDetail initialData={legacySummary} />),
    ).not.toThrow();
  });

  // BT-UI-003: failed run with summary shows blocked section (#163)
  test("BT-UI-003: failed run summary shows blocked section", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;
    const failedWithSummary = {
      ...detailData(),
      run: {
        ...detailData().run,
        status: "failed" as const,
        errorKind: "checks_failed",
        errorMessage: "Required background-agent check failed.",
        finishedAt: "2026-05-27T12:03:00.000Z",
        resultSummary: {
          headline: "Run failed — checks_failed",
          checked: [],
          changed: [],
          blocked: ["checks_failed: Required background-agent check failed."],
          artifacts: [],
          next: ["Fix CI and re-trigger"],
          warnings: [],
        },
      },
    };

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={failedWithSummary} />,
    );

    expect(html).toContain("Run summary");
    expect(html).toContain("Run failed — checks_failed");
    expect(html).toContain("Blocked");
    expect(html).toContain("checks_failed");
  });

  // BT-UI-004 (#798): a succeeded run with a Composio degradation warning
  // shows a distinct "Warnings" block — separate from "Blocked" — so an
  // operator can see a succeeded run still had a silent tool-resolution gap.
  test("BT-UI-004 (#798): succeeded run with composio warning shows distinct Warnings block", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;
    const succeededWithWarning = {
      ...detailData(),
      run: {
        ...detailData().run,
        status: "succeeded" as const,
        resultSummary: {
          headline: "Run succeeded — created ready_pr #42",
          checked: [],
          changed: [],
          blocked: [],
          artifacts: [],
          next: [],
          warnings: ["Composio toolkits resolved but not connected: slack."],
        },
      },
    };

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={succeededWithWarning} />,
    );

    expect(html).toContain("Warnings");
    expect(html).toContain("slack");
    // Warnings must be a distinct block from Blocked, not folded into it.
    expect(html).not.toContain("Blocked");
  });

  test("renders typed failure evidence when a run fails", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <BackgroundRunDetail
        initialData={detailData({
          run: {
            ...detailData().run,
            status: "failed",
            outputUrl: null,
            errorKind: "checks_failed",
            errorMessage: "Required background-agent check failed.",
            startedAt: "2026-05-27T12:01:00.000Z",
            finishedAt: "2026-05-27T12:03:00.000Z",
          },
          events: [
            {
              id: "event-failed",
              eventName: "background-agent.run.failed",
              status: "failed",
              summary: "Required background-agent check failed.",
              workflowRunId: "workflow-1",
              sandboxName: "background_agent_run_123",
              requestId: "req_123",
              errorKind: "checks_failed",
              redactionStatus: "passed",
              payload: {},
              createdAt: "2026-05-27T12:03:00.000Z",
            },
          ],
          outputs: [],
        })}
      />,
    );

    expect(html).toContain("failed");
    expect(html).toContain("checks_failed");
    expect(html).toContain("2m 0s");
    expect(html).toContain("Required background-agent check failed.");
    expect(html).toContain("background-agent.run.failed");
    expect(html).toContain("No outputs recorded.");
    expect(html).not.toContain("Refreshing");
  });

  // BT-168-RD-001: PR event-triggered run shows PR number in event context strip
  test("BT-168-RD-001: PR event-triggered run shows PR number, action, actor, and external ID in event context", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const base = detailData();
    const data: BackgroundRunDetailData = {
      ...base,
      run: {
        ...base.run,
        triggerKind: "github.pull_request",
        source: "github",
        prNumber: 42,
        issueNumber: null,
        deploymentUrl: null,
        externalId: "pull_request:9999:opened:abc123",
        branch: "main",
      },
    };

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={data} />,
    );

    // Trigger kind visible
    expect(html).toContain("github.pull_request");
    // PR number visible
    expect(html).toContain("PR #42");
    // External event ID visible in debug section
    expect(html).toContain("pull_request:9999:opened:abc123");
  });

  // BT-168-RD-002: Issue event-triggered run shows issue number in event context
  test("BT-168-RD-002: issue event run shows issue number and external ID", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const data = detailData({
      run: {
        ...detailData().run,
        triggerKind: "github.issue",
        source: "github",
        prNumber: null,
        issueNumber: 17,
        deploymentUrl: null,
        externalId: "issue:555:labeled",
      },
    });

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={data} />,
    );

    // Trigger kind visible
    expect(html).toContain("github.issue");
    // Issue number visible in trigger target
    expect(html).toContain("Issue #17");
    // External ID visible
    expect(html).toContain("issue:555:labeled");
  });

  // BT-168-RD-003: Deployment event run shows deployment URL and external ID
  test("BT-168-RD-003: deployment event run shows deployment URL and external ID", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const data = detailData({
      run: {
        ...detailData().run,
        triggerKind: "github.deployment_status",
        source: "github",
        prNumber: null,
        issueNumber: null,
        deploymentUrl: "https://myapp-preview.vercel.app",
        externalId: "deployment_status:77:success",
      },
    });

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={data} />,
    );

    // Trigger kind visible
    expect(html).toContain("github.deployment_status");
    // Deployment URL visible as trigger target
    expect(html).toContain("https://myapp-preview.vercel.app");
    // External ID visible
    expect(html).toContain("deployment_status:77:success");
  });

  // #795: permission_missing (and sibling typed errors) must surface a
  // plain-language "what happened / what to do" banner above the fold —
  // not just the raw errorKind mono text buried in the Debug section.
  test("#795: permission_missing run shows a plain-language banner above the Debug section", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const data = detailData({
      run: {
        ...detailData().run,
        status: "failed",
        errorKind: "permission_missing",
        errorMessage:
          "GitHub App installation lacks contents:write for acme/widgets.",
        finishedAt: "2026-05-27T12:03:00.000Z",
      },
    });

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={data} />,
    );

    // Plain-language copy renders, not just the raw kind.
    expect(html).toContain("doesn&#x27;t have write access");
    expect(html).toContain("Connect GitHub");
    // The banner's own "What happened" copy must never contain the raw
    // errorMessage internals (the sidebar Run card's existing raw
    // errorMessage text is untouched and out of scope for this assertion).
    const bannerStart = html.indexOf('aria-live="polite"');
    const bannerEnd = html.indexOf("</section>", bannerStart);
    const bannerHtml = html.slice(bannerStart, bannerEnd);
    expect(bannerHtml).not.toContain(
      "GitHub App installation lacks contents:write for acme/widgets.",
    );
    // The banner must appear before the Debug section in document order.
    const bannerPos = html.indexOf("doesn&#x27;t have write access");
    const debugPos = html.indexOf("Debug");
    expect(bannerPos).toBeGreaterThanOrEqual(0);
    expect(debugPos).toBeGreaterThan(bannerPos);
  });

  // #795: a run with no errorKind renders no banner at all.
  test("#795: succeeded run with no errorKind shows no error banner", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={detailData()} />,
    );

    expect(html).not.toContain("doesn&#x27;t have write access");
    expect(html).not.toContain("What happened");
  });

  // BT-168-RD-004: Event context section shows trigger kind label
  test("BT-168-RD-004: run detail renders Event context section with trigger kind", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const data = detailData({
      run: {
        ...detailData().run,
        triggerKind: "github.pull_request",
        prNumber: 7,
      },
    });

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={data} />,
    );

    // The "Event context" section heading should be present
    expect(html).toContain("Event context");
    // Trigger kind shown
    expect(html).toContain("github.pull_request");
  });

  // #747: sidebar "Run" section's Output field must reflect recorded action
  // outputs (kind + url), not the deprecated run.outputKind column.
  test("#747: sidebar Run section lists recorded output kinds and links, not run.outputKind", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const data = detailData({
      outputs: [
        {
          id: "output-1",
          kind: "push",
          status: "created",
          url: null,
          prNumber: null,
        },
        {
          id: "output-2",
          kind: "pr_comment",
          status: "created",
          url: "https://github.com/acme/widgets/pull/42#issuecomment-1",
          prNumber: 42,
        },
      ],
    });

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={data} />,
    );

    // The sidebar "Run" section's Output row lists both recorded output
    // kinds joined together, and the raw run.outputKind ("ready_pr" in
    // detailData()) must not leak into that row.
    expect(html).toContain("push, pr_comment");
  });

  test("#747: sidebar Run section Output field shows 'none' when no outputs are recorded", async () => {
    const { BackgroundRunDetail } = await componentModulePromise;

    const data = detailData({ outputs: [] });

    const html = renderToStaticMarkup(
      <BackgroundRunDetail initialData={data} />,
    );

    // Find the sidebar Run-section Output row specifically (not the proof-strip
    // Output tile, which has its own "none"/"pending" text) — assert the
    // "Run" section text block contains a bare "none" for the Output row.
    const runSectionStart = html.indexOf(
      '<h2 class="text-sm font-medium">Run</h2>',
    );
    const debugSectionStart = html.indexOf("Debug");
    expect(runSectionStart).toBeGreaterThanOrEqual(0);
    const runSectionHtml = html.slice(runSectionStart, debugSectionStart);
    expect(runSectionHtml).toContain(">none<");
  });
});
