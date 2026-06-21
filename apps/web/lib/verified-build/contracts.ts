import { z } from "zod";

const idSchema = z.string().min(1);
const isoTimestampSchema = z.string().datetime();

export const redactionStatusSchema = z.enum([
  "not_required",
  "pending",
  "passed",
  "redacted",
  "failed",
]);

export const evidenceKindSchema = z.enum([
  "unit",
  "typecheck",
  "lint",
  "api",
  "database",
  "worker_log",
  "browser",
  "agent_browser",
  "manual_review",
  "deployment",
  "security",
  "accessibility",
]);

export const workspaceModeSchema = z.enum(["shared", "isolated"]);

export const contractProvenanceSchema = z.object({
  created_at: isoTimestampSchema,
  created_by: z.object({
    actor_type: z.enum([
      "user",
      "coordinator",
      "sub_coordinator",
      "worker",
      "harness",
    ]),
    actor_id: idSchema,
  }),
  source_refs: z.array(z.string().min(1)),
});

export const artifactRefSchema = z.object({
  artifact_id: idSchema.optional(),
  kind: z
    .enum([
      "research_packet",
      "build_plan",
      "workcell_contract",
      "completion_packet",
      "plan_change_proposal",
      "integration_result",
      "final_report",
      "log",
      "diff",
      "screenshot",
      "trace",
      "gate_result",
      "failure_capsule",
      "manual_evidence",
    ])
    .optional(),
  path: z.string().optional(),
  url: z.string().url().optional(),
  sha256: z.string().optional(),
  redaction_status: redactionStatusSchema.default("not_required"),
  summary: z.string().optional(),
});

export const surfaceRefSchema = z.object({
  kind: z.enum([
    "file_glob",
    "route",
    "api_endpoint",
    "database_schema",
    "migration",
    "worker",
    "env_var",
    "provider_resource",
    "package",
    "test",
    "documentation",
  ]),
  value: z.string().min(1),
  access: z.enum(["read", "write", "own", "forbidden"]),
  reason: z.string().min(1),
});

export const behaviorRequirementSchema = z.object({
  behavior_id: idSchema,
  priority: z.enum(["required", "optional"]),
  statement: z.string().min(1),
  acceptance: z.string().min(1),
  required_evidence_kinds: z.array(evidenceKindSchema).min(1),
});

export const evidenceRefSchema = z.object({
  evidence_id: idSchema,
  behavior_ids: z.array(idSchema),
  kind: evidenceKindSchema,
  status: z.enum(["passed", "failed", "blocked", "needs_review"]),
  artifact_refs: z.array(artifactRefSchema),
  summary: z.string().min(1),
  limitations: z.array(z.string()),
});

export const delegatedWorkerLinkageSchema = z.object({
  worker_id: idSchema,
  run_id: idSchema,
  workspace_mode: workspaceModeSchema,
  completion_packet_id: idSchema.optional(),
  validation_status: z.enum(["valid", "invalid", "missing", "partial"]),
});

export const workcellContractSchema = z
  .object({
    workcell_id: idSchema,
    parent_id: idSchema,
    parent_kind: z.enum(["build_plan", "workcell"]),
    title: z.string().min(1),
    objective: z.string().min(1),
    owner_role: z.enum([
      "research_worker",
      "implementation_worker",
      "qa_worker",
      "integration_worker",
      "repair_worker",
      "sub_coordinator",
    ]),
    mode: z.enum(["research", "implementation", "integration", "qa", "repair"]),
    status: z.enum([
      "draft",
      "ready",
      "running",
      "blocked",
      "completed",
      "failed",
      "cancelled",
    ]),
    workspace_mode: workspaceModeSchema.default("isolated"),
    delegated_worker: delegatedWorkerLinkageSchema.optional(),
    assigned_agent: z
      .object({
        agent_id: idSchema,
        agent_kind: z.enum([
          "model_worker",
          "deterministic_worker",
          "sub_coordinator",
        ]),
        sandbox_ref: z.string().optional(),
      })
      .optional(),
    surfaces: z.object({
      readable: z.array(surfaceRefSchema),
      writable: z.array(surfaceRefSchema),
      owned: z.array(surfaceRefSchema),
      forbidden: z.array(surfaceRefSchema),
    }),
    dependencies: z.array(
      z.object({
        dependency_id: idSchema,
        kind: z.enum([
          "workcell",
          "research_packet",
          "approval",
          "external_input",
        ]),
        required_status: z.string().min(1),
      }),
    ),
    context: z.object({
      required_packet_ids: z.array(idSchema),
      optional_packet_ids: z.array(idSchema),
      repo_setup_summary: z.string(),
      commands_to_start: z.array(z.string()),
      commands_to_test: z.array(z.string()),
      relevant_lessons: z.array(z.string()),
    }),
    behavior_requirements: z.array(behaviorRequirementSchema),
    required_feedback_loop: z.array(
      z.object({
        step_id: idSchema,
        command_or_action: z.string().min(1),
        required: z.boolean(),
        evidence_kind: evidenceKindSchema.optional(),
      }),
    ),
    required_evidence: z.array(
      z.object({
        behavior_id: idSchema,
        evidence_kind: evidenceKindSchema,
        required_before_completion: z.boolean(),
      }),
    ),
    budget: z.object({
      max_wall_clock_minutes: z.number().nonnegative(),
      max_model_cost_usd: z.number().nonnegative(),
      max_repair_attempts: z.number().int().nonnegative(),
    }),
    done_criteria: z.array(z.string().min(1)),
    stop_conditions: z.array(z.string().min(1)),
    plan_change_policy: z.object({
      may_propose_changes: z.boolean(),
      may_apply_parent_plan_changes: z.literal(false),
      requires_parent_approval_for: z.array(
        z.enum([
          "architecture",
          "interface",
          "scope",
          "evidence",
          "provider",
          "credential",
        ]),
      ),
    }),
    provenance: contractProvenanceSchema,
  })
  .superRefine((workcell, ctx) => {
    const forbidden = new Set(
      workcell.surfaces.forbidden.map((surface) => surface.value),
    );
    for (const surface of workcell.surfaces.writable) {
      if (forbidden.has(surface.value)) {
        ctx.addIssue({
          code: "custom",
          path: ["surfaces", "writable"],
          message: "writable surfaces must not overlap forbidden surfaces",
        });
      }
    }

    if (
      workcell.status === "ready" &&
      workcell.mode !== "research" &&
      workcell.required_evidence.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["required_evidence"],
        message: "ready mutating workcells require evidence",
      });
    }
  });

export const workerCompletionPacketSchema = z.object({
  packet_id: idSchema,
  workcell_id: idSchema,
  status: z.enum(["done", "blocked", "failed", "needs_review"]),
  summary: z.string().min(1),
  changed_surfaces: z.array(surfaceRefSchema),
  files_changed: z.array(z.string()),
  scope_check: z.object({
    status: z.enum(["in_scope", "out_of_scope", "needs_review"]),
    violations: z.array(
      z.object({
        surface: surfaceRefSchema,
        reason: z.string().min(1),
      }),
    ),
  }),
  commands_run: z.array(
    z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      status: z.enum(["passed", "failed", "blocked", "skipped"]),
      artifact_refs: z.array(artifactRefSchema),
    }),
  ),
  gates_run: z.array(
    z.object({
      gate_id: idSchema,
      status: z.enum(["passed", "failed", "blocked", "skipped"]),
      covered_behavior_ids: z.array(idSchema),
      artifact_refs: z.array(artifactRefSchema),
    }),
  ),
  behavior_evidence: z.array(evidenceRefSchema),
  artifacts: z.array(artifactRefSchema),
  unproven_requirements: z.array(
    z.object({
      behavior_id: idSchema,
      reason: z.string().min(1),
      suggested_next_action: z.string().min(1),
    }),
  ),
  known_risks: z.array(
    z.object({
      summary: z.string().min(1),
      severity: z.enum(["low", "medium", "high"]),
      mitigation: z.string().optional(),
    }),
  ),
  blockers: z.array(
    z.object({
      summary: z.string().min(1),
      blocked_on: z.enum([
        "user",
        "coordinator",
        "external_service",
        "dependency",
        "budget",
        "credential",
      ]),
    }),
  ),
  diff_ref: artifactRefSchema.optional(),
  commit_ref: z.string().optional(),
  cost_summary: z.object({
    model_cost_usd: z.number().nonnegative(),
    sandbox_minutes: z.number().nonnegative().optional(),
    duration_ms: z.number().int().nonnegative(),
  }),
  self_review: z.object({
    checked_scope: z.boolean(),
    checked_tests: z.boolean(),
    checked_secrets: z.boolean(),
    notes: z.string(),
  }),
  suggested_next_action: z.enum([
    "integrate",
    "repair",
    "ask_user",
    "needs_review",
    "abandon",
  ]),
  delegated_worker: delegatedWorkerLinkageSchema,
  provenance: contractProvenanceSchema,
});

export const workcellEvidenceAttachmentSchema = z.object({
  workcell_id: idSchema,
  packet_id: idSchema,
  worker_id: idSchema,
  run_id: idSchema,
  workspace_mode: workspaceModeSchema,
  validation_status: z.enum(["valid", "invalid", "missing", "partial"]),
  scope_status: z.enum(["in_scope", "out_of_scope", "needs_review"]),
  evidence_refs: z.array(z.object({ evidence_id: idSchema })),
  verification_commands: z.array(z.string()),
  integration_outcome: z.enum(["ready", "repair", "blocked", "needs_review"]),
});

export const planChangeProposalSchema = z.object({
  proposal_id: idSchema,
  source_workcell_id: idSchema,
  source_worker_id: idSchema.optional(),
  change_type: z.enum([
    "architecture",
    "interface",
    "scope",
    "evidence",
    "dependency",
    "timeline",
    "budget",
  ]),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  proposed_updates: z.array(
    z.object({
      target_artifact_id: idSchema,
      field_path: z.string().min(1),
      summary: z.string().min(1),
    }),
  ),
  status: z.enum(["proposed", "accepted", "rejected", "superseded"]),
  provenance: contractProvenanceSchema,
});

export const finalBuildReportSchema = z
  .object({
    report_id: idSchema,
    build_plan_id: idSchema,
    final_status: z.enum(["go", "no_go", "needs_review", "blocked"]),
    user_goal_summary: z.string().min(1),
    work_completed: z.array(
      z.object({
        workcell_id: idSchema,
        summary: z.string().min(1),
        status: z.string().min(1),
        delegated_worker: delegatedWorkerLinkageSchema.optional(),
      }),
    ),
    behavior_coverage: z.array(
      z.object({
        behavior_id: idSchema,
        priority: z.enum(["required", "optional"]),
        status: z.enum(["proven", "waived", "missing", "blocked"]),
        evidence_refs: z.array(evidenceRefSchema),
        notes: z.string(),
      }),
    ),
    gates_run: z.array(
      z.object({
        gate_id: idSchema,
        status: z.enum(["passed", "failed", "blocked", "skipped"]),
        summary: z.string().min(1),
      }),
    ),
    evidence_artifacts: z.array(artifactRefSchema),
    integrations: z.array(
      z.object({
        integration_id: idSchema,
        status: z.string().min(1),
        summary: z.string().min(1),
      }),
    ),
    repairs_performed: z.array(
      z.object({
        repair_workcell_id: idSchema,
        failure_summary: z.string().min(1),
        status: z.string().min(1),
      }),
    ),
    unproven_requirements: z.array(
      z.object({
        behavior_id: idSchema,
        reason: z.string().min(1),
        required_for_go: z.boolean(),
      }),
    ),
    known_risks: z.array(
      z.object({
        summary: z.string().min(1),
        severity: z.enum(["low", "medium", "high"]),
        mitigation: z.string().optional(),
      }),
    ),
    approval_history: z.array(
      z.object({
        approval_id: idSchema,
        kind: z.string().min(1),
        status: z.enum(["approved", "rejected", "waived"]),
        rationale: z.string().min(1),
      }),
    ),
    cost_and_duration: z.object({
      total_model_cost_usd: z.number().nonnegative(),
      total_duration_ms: z.number().int().nonnegative(),
      worker_count: z.number().int().nonnegative(),
      repair_count: z.number().int().nonnegative(),
    }),
    next_recommended_action: z.string().min(1),
    artifact_refs: z.array(artifactRefSchema),
    provenance: contractProvenanceSchema,
  })
  .superRefine((report, ctx) => {
    if (report.final_status !== "go") {
      return;
    }

    const unprovenRequired = report.behavior_coverage.find(
      (coverage) =>
        coverage.priority === "required" &&
        coverage.status !== "proven" &&
        coverage.status !== "waived",
    );
    if (unprovenRequired) {
      ctx.addIssue({
        code: "custom",
        path: ["behavior_coverage"],
        message: "go requires required behaviors to be proven or waived",
      });
    }

    const failedGate = report.gates_run.find(
      (gate) => gate.status === "failed" || gate.status === "blocked",
    );
    if (failedGate) {
      ctx.addIssue({
        code: "custom",
        path: ["gates_run"],
        message: "go requires final gates to pass or be explicitly waived",
      });
    }

    const failedRedaction = report.evidence_artifacts.find(
      (artifact) => artifact.redaction_status === "failed",
    );
    if (failedRedaction) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence_artifacts"],
        message: "go is not allowed when artifact redaction failed",
      });
    }
  });

export type WorkcellContract = z.infer<typeof workcellContractSchema>;
export type WorkerCompletionPacket = z.infer<
  typeof workerCompletionPacketSchema
>;
export type FinalBuildReport = z.infer<typeof finalBuildReportSchema>;

export function buildDelegatedWorkerLaunchFromWorkcell(workcellInput: unknown) {
  const workcell = workcellContractSchema.parse(workcellInput);
  return {
    workcellId: workcell.workcell_id,
    workspacePolicy: workcell.workspace_mode,
    scope: {
      readable: workcell.surfaces.readable.map((surface) => surface.value),
      writable: workcell.surfaces.writable.map((surface) => surface.value),
      forbidden: workcell.surfaces.forbidden.map((surface) => surface.value),
    },
    requiredEvidenceKinds: [
      ...new Set(
        workcell.required_evidence.map((evidence) => evidence.evidence_kind),
      ),
    ],
  };
}

export function attachCompletionPacketToWorkcellEvidence(params: {
  workcell: unknown;
  packet: unknown;
}) {
  const workcell = workcellContractSchema.parse(params.workcell);
  const packet = workerCompletionPacketSchema.parse(params.packet);

  if (packet.workcell_id !== workcell.workcell_id) {
    throw new Error("completion_packet_workcell_mismatch");
  }

  return workcellEvidenceAttachmentSchema.parse({
    workcell_id: workcell.workcell_id,
    packet_id: packet.packet_id,
    worker_id: packet.delegated_worker.worker_id,
    run_id: packet.delegated_worker.run_id,
    workspace_mode: packet.delegated_worker.workspace_mode,
    validation_status: packet.delegated_worker.validation_status,
    scope_status: packet.scope_check.status,
    evidence_refs: packet.behavior_evidence.map((evidence) => ({
      evidence_id: evidence.evidence_id,
    })),
    verification_commands: packet.commands_run
      .filter((command) => command.status === "passed")
      .map((command) => command.command),
    integration_outcome:
      packet.status === "done" &&
      packet.scope_check.status === "in_scope" &&
      packet.delegated_worker.validation_status === "valid"
        ? "ready"
        : packet.status === "blocked"
          ? "blocked"
          : "repair",
  });
}
