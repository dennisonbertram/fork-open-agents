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
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[]} />,
    );

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

// ---------------------------------------------------------------------------
// REGRESSION tests — catch if the presenter is removed, the gating logic
// is reverted, or the empty-state path is broken
// ---------------------------------------------------------------------------

describe("regression: WorkflowArtifactsSection gating and presenter integrity", () => {
  // REGRESSION-4: Section heading must always be present (catches component removal)
  test("REGRESSION-4: Workflow Artifacts section heading is always rendered", () => {
    const emptyHtml = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[]} />,
    );
    const populatedHtml = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[passedArtifact()]} />,
    );

    expect(emptyHtml).toContain("Workflow Artifacts");
    expect(populatedHtml).toContain("Workflow Artifacts");
  });

  // REGRESSION-5: passed artifact content is always shown (catches over-redaction)
  test("REGRESSION-5: passed artifact content appears — not accidentally gated", () => {
    const uniqueSummary = "UNIQUE_SUMMARY_MUST_APPEAR_IN_PASSED_RENDER";
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ summary: uniqueSummary })]}
      />,
    );

    expect(html).toContain(uniqueSummary);
  });

  // REGRESSION-6: each non-passed status has a specific gated placeholder
  // (catches if placeholder map is cleared or keys are renamed)
  test("REGRESSION-6: each non-passed redactionStatus has correct gated placeholder text", () => {
    const pendingHtml = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[pendingArtifact()]} />,
    );
    const failedHtml = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[failedArtifact()]} />,
    );
    const blockedHtml = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[blockedArtifact()]} />,
    );

    expect(pendingHtml).toContain("Redacted");
    expect(pendingHtml).toContain("pending review");
    expect(failedHtml).toContain("Redacted");
    expect(failedHtml).toContain("PII detected");
    expect(blockedHtml).toContain("Blocked");
    expect(blockedHtml).toContain("pending review");
  });

  // REGRESSION-7: empty-state message is specific enough to be testable
  test("REGRESSION-7: empty state message is shown for [] and not for non-empty artifacts", () => {
    const emptyHtml = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[]} />,
    );
    const populatedHtml = renderToStaticMarkup(
      <WorkflowArtifactsSection artifacts={[passedArtifact()]} />,
    );

    expect(emptyHtml).toContain("No workflow artifacts");
    // The empty-state message does NOT appear when artifacts are present
    expect(populatedHtml).not.toContain("No workflow artifacts");
  });
});

// ---------------------------------------------------------------------------
// FIX 1: kind grouping tests (RED — will fail until grouping is implemented)
// ---------------------------------------------------------------------------

describe("FIX-1: WorkflowArtifactsSection renders artifacts grouped by kind", () => {
  // BT-018: A kind-group heading/label is rendered for each kind present
  test("BT-018: renders a labeled group heading for each distinct kind present", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[
          passedArtifact({ kind: "research_packet", id: "a1" }),
          passedArtifact({ kind: "spec", id: "a2" }),
        ]}
      />,
    );

    // Each kind should appear as a distinct group heading/label
    // "Research packet" or "research packet" heading for research_packet
    expect(html).toMatch(/research.?packet/i);
    // "Spec" heading for spec — at minimum the kind label in a group-heading element
    // The heading should appear at least once more than just in the artifact row
    // (i.e., there is a dedicated group heading in addition to the row label)
    const researchMatches = (html.match(/research.?packet/gi) ?? []).length;
    expect(researchMatches).toBeGreaterThanOrEqual(2);
  });

  // BT-019: a kind with no artifacts does NOT render an empty group heading
  test("BT-019: kinds with no artifacts do not render an empty group heading", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ kind: "research_packet", id: "a1" })]}
      />,
    );

    // "spec" kind is not in the artifacts — it must not appear as a heading
    // We check that "spec" does not appear as a standalone group heading.
    // "Spec" group heading must be absent when there are no spec artifacts.
    // The HTML should only reference "research_packet" kind, not "spec" heading.
    expect(html).not.toMatch(/data-kind-group="spec"/i);
  });

  // BT-020: artifacts appear under their kind group (grouped, not flat)
  test("BT-020: receipt artifact appears under the receipt kind group heading", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[
          blockedArtifact({ kind: "receipt", id: "r1" }),
          failedArtifact({ kind: "gate_report", id: "g1" }),
        ]}
      />,
    );

    // Both groups must have their group headings
    expect(html).toMatch(/data-kind-group="receipt"/i);
    expect(html).toMatch(/data-kind-group="gate.?report"/i);
    // receipt group heading must appear
    expect(html).toMatch(/receipt/i);
    // gate_report group heading must appear
    expect(html).toMatch(/gate.?report/i);
  });

  // BT-021: group heading for a kind is a distinct element (data-kind-group attribute)
  test("BT-021: group headings use data-kind-group attribute for each present kind", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[
          passedArtifact({ kind: "research_packet", id: "a1" }),
          passedArtifact({ kind: "spec", id: "a2" }),
          passedArtifact({ kind: "receipt", id: "a3" }),
        ]}
      />,
    );

    expect(html).toContain('data-kind-group="research_packet"');
    expect(html).toContain('data-kind-group="spec"');
    expect(html).toContain('data-kind-group="receipt"');
    // final_build_report is not in the artifacts — should not appear as group
    expect(html).not.toContain('data-kind-group="final_build_report"');
    expect(html).not.toContain('data-kind-group="gate_report"');
  });
});

// ---------------------------------------------------------------------------
// FIX 2: distinct non-current status treatment (RED — will fail until implemented)
// ---------------------------------------------------------------------------

describe("FIX-2: WorkflowArtifactsSection renders non-current statuses with distinct treatment", () => {
  // BT-022: superseded artifact renders its distinct label
  test("BT-022: superseded artifact renders 'Superseded' label", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ id: "sup-1", status: "superseded" })]}
      />,
    );

    expect(html).toContain("Superseded");
    // Must have the de-emphasized/muted data attribute for visual treatment
    expect(html).toContain('data-non-current="true"');
  });

  // BT-023: missing artifact renders "Unavailable (missing)" label
  test("BT-023: missing artifact renders 'Unavailable (missing)' label", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ id: "miss-1", status: "missing" })]}
      />,
    );

    expect(html).toContain("Unavailable (missing)");
    expect(html).toContain('data-non-current="true"');
  });

  // BT-024: archived artifact renders "Archived" label
  test("BT-024: archived artifact renders 'Archived' label", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ id: "arch-1", status: "archived" })]}
      />,
    );

    expect(html).toContain("Archived");
    expect(html).toContain('data-non-current="true"');
  });

  // BT-025: redacted-status artifact renders "Redacted" label (ARTIFACT_STATUS redacted)
  test("BT-025: status=redacted artifact renders 'Redacted' label", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ id: "red-1", status: "redacted" })]}
      />,
    );

    expect(html).toContain("Redacted");
    expect(html).toContain('data-non-current="true"');
  });

  // BT-026: available artifact does NOT get the de-emphasized treatment
  test("BT-026: available artifact does NOT have data-non-current='true'", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ id: "avail-1", status: "available" })]}
      />,
    );

    expect(html).not.toContain('data-non-current="true"');
  });

  // BT-027: generating artifact does NOT get the de-emphasized treatment
  test("BT-027: generating artifact does NOT have data-non-current='true'", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ id: "gen-1", status: "generating" })]}
      />,
    );

    expect(html).not.toContain('data-non-current="true"');
  });
});

// ---------------------------------------------------------------------------
// FIX 3: Presenter-gate mutation coverage (RED — will fail until mutation
// coverage test forces the isPassed gate to be fully exercised)
// ---------------------------------------------------------------------------

describe("FIX-3: Presenter-gate mutation coverage (isPassed gate)", () => {
  // BT-028: pending artifact with non-null summary/sourceLocation — gate must strip them
  test("BT-028: pending artifact with non-null summary+sourceLocation — content absent, placeholder present", () => {
    const secretSummary = "MUTATION_SECRET_SUMMARY_PENDING_MUST_NOT_APPEAR";
    const secretLocation = "s3://mutation-test/pending-secret.md";

    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[
          pendingArtifact({
            summary: secretSummary,
            sourceLocation: secretLocation,
          }),
        ]}
      />,
    );

    // The gate must strip these from the rendered output
    expect(html).not.toContain(secretSummary);
    expect(html).not.toContain(secretLocation);
    // And the placeholder must be shown instead
    expect(html).toContain("pending review");
  });

  // BT-029: failed artifact with non-null summary+sourceLocation — gate must strip them
  test("BT-029: failed artifact with non-null summary+sourceLocation — content absent, placeholder present", () => {
    const secretSummary = "MUTATION_SECRET_SUMMARY_FAILED_MUST_NOT_APPEAR";
    const secretLocation = "s3://mutation-test/failed-secret.md";

    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[
          failedArtifact({
            summary: secretSummary,
            sourceLocation: secretLocation,
          }),
        ]}
      />,
    );

    expect(html).not.toContain(secretSummary);
    expect(html).not.toContain(secretLocation);
    expect(html).toContain("PII detected");
  });

  // BT-030: blocked artifact with non-null summary+sourceLocation — gate must strip them
  test("BT-030: blocked artifact with non-null summary+sourceLocation — content absent, placeholder present", () => {
    const secretSummary = "MUTATION_SECRET_SUMMARY_BLOCKED_MUST_NOT_APPEAR";
    const secretLocation = "s3://mutation-test/blocked-secret.md";

    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[
          blockedArtifact({
            summary: secretSummary,
            sourceLocation: secretLocation,
          }),
        ]}
      />,
    );

    expect(html).not.toContain(secretSummary);
    expect(html).not.toContain(secretLocation);
    expect(html).toContain("Blocked");
  });
});

// ---------------------------------------------------------------------------
// REGRESSION tests — catch future breakage of FIX 1 + FIX 2 + FIX 3 changes
// ---------------------------------------------------------------------------

describe("regression: kind-grouping, non-current treatment, and gate mutation", () => {
  // REGRESSION-8: reverting grouping removes data-kind-group attributes
  test("REGRESSION-8: data-kind-group attributes are present for all provided kinds", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[
          passedArtifact({ kind: "research_packet", id: "rp1" }),
          passedArtifact({ kind: "final_build_report", id: "fbr1" }),
        ]}
      />,
    );

    expect(html).toContain('data-kind-group="research_packet"');
    expect(html).toContain('data-kind-group="final_build_report"');
    // Kinds not in the artifact list must not produce group headings
    expect(html).not.toContain('data-kind-group="spec"');
    expect(html).not.toContain('data-kind-group="gate_report"');
    expect(html).not.toContain('data-kind-group="receipt"');
  });

  // REGRESSION-9: reverting non-current labels removes "Superseded" / "Unavailable"
  test("REGRESSION-9: superseded and missing statuses render their distinct labels", () => {
    const supersededHtml = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ status: "superseded" })]}
      />,
    );
    const missingHtml = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ status: "missing" })]}
      />,
    );

    expect(supersededHtml).toContain("Superseded");
    expect(supersededHtml).toContain('data-non-current="true"');
    expect(missingHtml).toContain("Unavailable (missing)");
    expect(missingHtml).toContain('data-non-current="true"');
  });

  // REGRESSION-10: available artifacts must NOT get the non-current treatment
  // (guards against accidentally marking all artifacts as de-emphasized)
  test("REGRESSION-10: available artifact never gets data-non-current treatment", () => {
    const html = renderToStaticMarkup(
      <WorkflowArtifactsSection
        artifacts={[passedArtifact({ status: "available" })]}
      />,
    );

    expect(html).not.toContain('data-non-current="true"');
    expect(html).not.toContain("Superseded");
    expect(html).not.toContain("Unavailable");
    expect(html).not.toContain("Archived");
  });
});
