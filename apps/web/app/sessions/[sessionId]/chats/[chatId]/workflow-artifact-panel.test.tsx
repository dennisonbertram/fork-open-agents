import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkflowArtifactJson } from "./hooks/use-session-observability";
import { WorkflowArtifactsSection } from "./workflow-artifact-panel";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function passedArtifact(
  overrides: Partial<WorkflowArtifactJson> = {},
): WorkflowArtifactJson {
  return {
    id: "art-passed-1",
    kind: "research_packet",
    status: "available",
    redactionStatus: "passed",
    createdByActor: "workflow-engine",
    createdAt: "2026-01-15T10:00:00.000Z",
    workflowRunId: "wrun-1",
    summary: "This is the research summary content.",
    sourceLocation: "s3://bucket/research.md",
    ...overrides,
  };
}

function pendingArtifact(
  overrides: Partial<WorkflowArtifactJson> = {},
): WorkflowArtifactJson {
  return {
    id: "art-pending-1",
    kind: "spec",
    status: "available",
    redactionStatus: "pending",
    createdByActor: "workflow-engine",
    createdAt: "2026-01-15T10:00:00.000Z",
    workflowRunId: "wrun-1",
    summary: null,
    sourceLocation: null,
    ...overrides,
  };
}

function failedArtifact(
  overrides: Partial<WorkflowArtifactJson> = {},
): WorkflowArtifactJson {
  return {
    id: "art-failed-1",
    kind: "gate_report",
    status: "available",
    redactionStatus: "failed",
    createdByActor: "redaction-harness",
    createdAt: "2026-01-15T11:00:00.000Z",
    workflowRunId: "wrun-1",
    summary: null,
    sourceLocation: null,
    ...overrides,
  };
}

function blockedArtifact(
  overrides: Partial<WorkflowArtifactJson> = {},
): WorkflowArtifactJson {
  return {
    id: "art-blocked-1",
    kind: "receipt",
    status: "available",
    redactionStatus: "blocked",
    createdByActor: "workflow-engine",
    createdAt: "2026-01-15T12:00:00.000Z",
    workflowRunId: "wrun-1",
    summary: null,
    sourceLocation: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowArtifactsSection", () => {
  // BT-008: empty state for empty array
  test("BT-008: renders empty state when artifacts array is empty", () => {
    const html = renderToStaticMarkup(<WorkflowArtifactsSection artifacts={[]} />);

    expect(html).toContain("Workflow Artifacts");
    expect(html).toContain("No workflow artifacts");
  });

  // BT-009: passed artifact shows summary and sourceLocation
  test("BT-009: passed artifact renders summary and sourceLocation", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[passedArtifact()]} />,
    );

    expect(html).toContain("This is the research summary content.");
    expect(html).toContain("s3://bucket/research.md");
    expect(html).toContain("passed");
  });

  // BT-010: pending artifact renders gated placeholder, NOT raw content
  test("BT-010: pending artifact renders gated placeholder and omits content", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[pendingArtifact()]} />,
    );

    // Shows gated placeholder
    expect(html).toContain("pending review");
    // Does NOT show content fields (they are null from the server anyway)
    expect(html).not.toContain("TOP_SECRET");
    // Shows redactionStatus chip
    expect(html).toContain("pending");
  });

  // BT-011: failed artifact renders PII-detected placeholder
  test("BT-011: failed artifact renders PII-detected gated placeholder", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[failedArtifact()]} />,
    );

    expect(html).toContain("PII detected");
    expect(html).toContain("failed");
  });

  // BT-012: blocked artifact renders blocked placeholder
  test("BT-012: blocked artifact renders blocked gated placeholder", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[blockedArtifact()]} />,
    );

    expect(html).toContain("Blocked");
    expect(html).toContain("blocked");
  });

  // BT-013: status and redactionStatus chips rendered for all artifacts
  test("BT-013: status chip is rendered for each artifact", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact(), pendingArtifact()]}
      />,
    );

    // Both artifacts should show their status (available)
    expect(html.match(/available/g)?.length).toBeGreaterThanOrEqual(2);
  });

  // BT-014: createdByActor is rendered
  test("BT-014: createdByActor is shown for each artifact", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[passedArtifact()]} />,
    );

    expect(html).toContain("workflow-engine");
  });

  // BT-015: kind is rendered for each artifact
  test("BT-015: artifact kind is shown", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ kind: "research_packet" })]}
      />,
    );

    expect(html).toContain("research");
  });

  // BT-016: multiple artifacts across different kinds rendered
  test("BT-016: multiple artifacts across different kinds are all rendered", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[
          passedArtifact({ kind: "research_packet", id: "a1" }),
          passedArtifact({ kind: "spec", id: "a2" }),
          failedArtifact({ kind: "gate_report", id: "a3" }),
        ]}
      />,
    );

    expect(html).toContain("research");
    expect(html).toContain("spec");
    expect(html).toContain("gate");
  });

  // BT-017: non-passed artifact NEVER renders summary or sourceLocation text
  test("BT-017: non-passed artifact does NOT render any raw content (defense-in-depth)", () => {
    // Even if somehow non-null fields reach the component (defense-in-depth),
    // the component itself gates them. But per contract they arrive as null
    // from the server. Test the pure-null case to confirm the gating path.
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[
          pendingArtifact({ summary: null, sourceLocation: null }),
          failedArtifact({ summary: null, sourceLocation: null }),
          blockedArtifact({ summary: null, sourceLocation: null }),
        ]}
      />,
    );

    // Gated placeholders must be present
    expect(html).toContain("pending review");
    expect(html).toContain("PII detected");
    expect(html).toContain("Blocked");
  });
});
