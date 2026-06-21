import { describe, expect, test } from "bun:test";
import {
  attachCompletionPacketToWorkcellEvidence,
  buildDelegatedWorkerLaunchFromWorkcell,
  finalBuildReportSchema,
  planChangeProposalSchema,
  workcellContractSchema,
} from "./contracts";

const provenance = {
  created_at: "2026-06-21T12:00:00.000Z",
  created_by: { actor_type: "coordinator", actor_id: "coordinator-1" },
  source_refs: ["issue:#596"],
} as const;

const surface = {
  kind: "file_glob",
  value: "apps/web/lib/verified-build/**",
  access: "write",
  reason: "Verified Build contract implementation.",
} as const;

function workcell(overrides: Record<string, unknown> = {}) {
  return workcellContractSchema.parse({
    workcell_id: "workcell_contracts",
    parent_id: "build_verified",
    parent_kind: "build_plan",
    title: "Implement contract linkage",
    objective: "Connect workcells to delegated worker evidence.",
    owner_role: "implementation_worker",
    mode: "implementation",
    status: "ready",
    workspace_mode: "isolated",
    delegated_worker: {
      worker_id: "worker-1",
      run_id: "delegated-worker:run-1",
      workspace_mode: "isolated",
      completion_packet_id: "packet-1",
      validation_status: "valid",
    },
    surfaces: {
      readable: [surface],
      writable: [surface],
      owned: [],
      forbidden: [
        {
          ...surface,
          value: "apps/web/.env*",
          access: "forbidden",
          reason: "Never expose secrets.",
        },
      ],
    },
    dependencies: [],
    context: {
      required_packet_ids: [],
      optional_packet_ids: [],
      repo_setup_summary: "bun install already complete.",
      commands_to_start: [],
      commands_to_test: [
        "bun test apps/web/lib/verified-build/contracts.test.ts",
      ],
      relevant_lessons: [],
    },
    behavior_requirements: [
      {
        behavior_id: "behavior_contracts",
        priority: "required",
        statement: "Workcell evidence is linked to delegated workers.",
        acceptance: "Validated packet is attached to the workcell.",
        required_evidence_kinds: ["unit"],
      },
    ],
    required_feedback_loop: [
      {
        step_id: "test-contracts",
        command_or_action:
          "bun test apps/web/lib/verified-build/contracts.test.ts",
        required: true,
        evidence_kind: "unit",
      },
    ],
    required_evidence: [
      {
        behavior_id: "behavior_contracts",
        evidence_kind: "unit",
        required_before_completion: true,
      },
    ],
    budget: {
      max_wall_clock_minutes: 30,
      max_model_cost_usd: 2,
      max_repair_attempts: 1,
    },
    done_criteria: ["Contract tests pass."],
    stop_conditions: ["Plan change required."],
    plan_change_policy: {
      may_propose_changes: true,
      may_apply_parent_plan_changes: false,
      requires_parent_approval_for: ["architecture", "scope", "evidence"],
    },
    provenance,
    ...overrides,
  });
}

describe("Verified Build delegated workcell contracts", () => {
  test("maps workcell workspace mode and scope into a delegated worker launch", () => {
    const launch = buildDelegatedWorkerLaunchFromWorkcell(workcell());

    expect(launch).toEqual({
      workcellId: "workcell_contracts",
      workspacePolicy: "isolated",
      scope: {
        readable: ["apps/web/lib/verified-build/**"],
        writable: ["apps/web/lib/verified-build/**"],
        forbidden: ["apps/web/.env*"],
      },
      requiredEvidenceKinds: ["unit"],
    });
  });

  test("attaches a valid completion packet to the matching workcell evidence", () => {
    const evidence = attachCompletionPacketToWorkcellEvidence({
      workcell: workcell(),
      packet: {
        packet_id: "packet-1",
        workcell_id: "workcell_contracts",
        status: "done",
        summary: "Implemented and tested contract linkage.",
        changed_surfaces: [surface],
        files_changed: ["apps/web/lib/verified-build/contracts.ts"],
        scope_check: { status: "in_scope", violations: [] },
        commands_run: [
          {
            command: "bun test apps/web/lib/verified-build/contracts.test.ts",
            status: "passed",
            artifact_refs: [],
          },
        ],
        gates_run: [],
        behavior_evidence: [
          {
            evidence_id: "evidence-unit-1",
            behavior_ids: ["behavior_contracts"],
            kind: "unit",
            status: "passed",
            artifact_refs: [],
            summary: "Contract unit test passed.",
            limitations: [],
          },
        ],
        artifacts: [],
        unproven_requirements: [],
        known_risks: [],
        blockers: [],
        cost_summary: {
          model_cost_usd: 0.12,
          duration_ms: 1000,
        },
        self_review: {
          checked_scope: true,
          checked_tests: true,
          checked_secrets: true,
          notes: "No out-of-scope surfaces.",
        },
        suggested_next_action: "integrate",
        delegated_worker: {
          worker_id: "worker-1",
          run_id: "delegated-worker:run-1",
          workspace_mode: "isolated",
          validation_status: "valid",
        },
        provenance,
      },
    });

    expect(evidence).toMatchObject({
      workcell_id: "workcell_contracts",
      worker_id: "worker-1",
      workspace_mode: "isolated",
      validation_status: "valid",
      evidence_refs: [{ evidence_id: "evidence-unit-1" }],
    });
  });

  test("rejects packet attachment for the wrong workcell", () => {
    expect(() =>
      attachCompletionPacketToWorkcellEvidence({
        workcell: workcell(),
        packet: {
          packet_id: "packet-1",
          workcell_id: "workcell_other",
          status: "done",
          summary: "Wrong workcell.",
          changed_surfaces: [],
          files_changed: [],
          scope_check: { status: "in_scope", violations: [] },
          commands_run: [],
          gates_run: [],
          behavior_evidence: [],
          artifacts: [],
          unproven_requirements: [],
          known_risks: [],
          blockers: [],
          cost_summary: { model_cost_usd: 0, duration_ms: 1 },
          self_review: {
            checked_scope: true,
            checked_tests: true,
            checked_secrets: true,
            notes: "n/a",
          },
          suggested_next_action: "integrate",
          delegated_worker: {
            worker_id: "worker-1",
            run_id: "delegated-worker:run-1",
            workspace_mode: "isolated",
            validation_status: "valid",
          },
          provenance,
        },
      }),
    ).toThrow("completion_packet_workcell_mismatch");
  });

  test("requires final reports to include delegated worker provenance for completed workcells", () => {
    const report = finalBuildReportSchema.parse({
      report_id: "report-1",
      build_plan_id: "build_verified",
      final_status: "go",
      user_goal_summary: "Implement Verified Build linkage.",
      work_completed: [
        {
          workcell_id: "workcell_contracts",
          summary: "Contract linkage implemented.",
          status: "completed",
          delegated_worker: {
            worker_id: "worker-1",
            run_id: "delegated-worker:run-1",
            workspace_mode: "isolated",
            validation_status: "valid",
          },
        },
      ],
      behavior_coverage: [
        {
          behavior_id: "behavior_contracts",
          priority: "required",
          status: "proven",
          evidence_refs: [],
          notes: "Covered by unit evidence.",
        },
      ],
      gates_run: [
        { gate_id: "unit", status: "passed", summary: "Unit passed." },
      ],
      evidence_artifacts: [],
      integrations: [
        {
          integration_id: "integration-1",
          status: "passed",
          summary: "Integrated.",
        },
      ],
      repairs_performed: [],
      unproven_requirements: [],
      known_risks: [],
      approval_history: [],
      cost_and_duration: {
        total_model_cost_usd: 0.12,
        total_duration_ms: 1000,
        worker_count: 1,
        repair_count: 0,
      },
      next_recommended_action: "Ship.",
      artifact_refs: [],
      provenance,
    });

    expect(report.work_completed[0]?.delegated_worker?.workspace_mode).toBe(
      "isolated",
    );
  });

  test("keeps worker-discovered plan changes as proposals", () => {
    const proposal = planChangeProposalSchema.parse({
      proposal_id: "proposal-scope-1",
      source_workcell_id: "workcell_contracts",
      source_worker_id: "worker-1",
      change_type: "scope",
      summary: "Need to include the contract fixture file.",
      rationale: "Tests require a fixture to prove final report evidence.",
      proposed_updates: [
        {
          target_artifact_id: "workcell_contracts",
          field_path: "surfaces.writable",
          summary: "Add fixture path to writable surfaces.",
        },
      ],
      status: "proposed",
      provenance,
    });

    expect(proposal.status).toBe("proposed");
  });
});
