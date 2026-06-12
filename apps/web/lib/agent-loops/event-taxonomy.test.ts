/**
 * Agent Loops — Event Taxonomy Presence Test (M1-10)
 *
 * Table-driven test: for every event name in the M1 event taxonomy,
 * assert the exact string literal exists in the lib/agent-loops source files.
 *
 * Purpose: pins the taxonomy against silent renames. Observability tooling
 * (dashboards, alerts, log queries) greps these exact event name strings.
 *
 * The test reads source files and asserts the literal string appears.
 * This is intentionally grep-style — we are testing the EVENT NAMES, not
 * the business logic (which has its own behavioral tests).
 *
 * DEFERRED events (not implemented in M1, to be added in M2/M3):
 * - agent-loop.context.merged   — context merge path exists but emits no
 *   distinct event (payload is part of step.completed); deferred for M2
 * - agent-loop.watchdog.*       — M3 scope only
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const LIB_DIR = join(
  import.meta.dir, // apps/web/lib/agent-loops/
  ".",
);

// Read all source files in lib/agent-loops (non-test .ts files)
function readSourceFiles(): string {
  const files = readdirSync(LIB_DIR).filter(
    (f: string) =>
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".regression.test.ts"),
  );
  return files
    .map((f: string) => readFileSync(join(LIB_DIR, f), "utf-8"))
    .join("\n");
}

// Also check the sweep route and any api routes for sweep events
function readApiFiles(): string {
  const sweepRouteDir = join(
    import.meta.dir,
    "../../app/api/agent-loops/sweep",
  );
  try {
    const files = readdirSync(sweepRouteDir).filter(
      (f: string) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    return files
      .map((f: string) => readFileSync(join(sweepRouteDir, f), "utf-8"))
      .join("\n");
  } catch {
    return "";
  }
}

/**
 * M1 event taxonomy from epic #319 §10.
 *
 * Each entry: { name, source: where it's emitted, deferred?: true if M2/M3 }
 */
const M1_TAXONOMY: Array<{
  name: string;
  description: string;
  deferred?: true;
  deferredReason?: string;
}> = [
  // Run lifecycle
  { name: "agent-loop.run.created", description: "Run created by dispatcher" },
  {
    name: "agent-loop.run.started",
    description: "Run transitioned queued→running",
  },
  { name: "agent-loop.run.completed", description: "Run reached end node" },
  {
    name: "agent-loop.run.failed",
    description: "Run failed (via updateAgentLoopRunStatus calls)",
  },
  { name: "agent-loop.run.paused", description: "Run paused via API" },
  { name: "agent-loop.run.resumed", description: "Run resumed via API" },
  { name: "agent-loop.run.cancelled", description: "Run cancelled via API" },
  {
    name: "agent-loop.run.stalled",
    description: "Run stalled (no event for threshold)",
  },
  { name: "agent-loop.run.retry", description: "Run retry initiated via API" },

  // Step lifecycle
  { name: "agent-loop.step.started", description: "Step execution started" },
  {
    name: "agent-loop.step.completed",
    description: "Step completed successfully",
  },
  { name: "agent-loop.step.failed", description: "Step failed" },

  // Agent step sub-events
  {
    name: "agent-loop.step.sandbox.started",
    description: "Sandbox started for agent_step",
  },
  {
    name: "agent-loop.step.agent.completed",
    description: "Agent completed within step",
  },
  {
    name: "agent-loop.step.check.completed",
    description: "Check command completed",
  },
  {
    name: "agent-loop.step.commit.completed",
    description: "Commit+push completed",
  },
  { name: "agent-loop.step.commit.failed", description: "Commit+push failed" },

  // Edge / chain
  {
    name: "agent-loop.edge.evaluated",
    description: "Edge evaluated, next node resolved",
  },
  {
    name: "agent-loop.guardrail.tripped",
    description: "Guardrail limit exceeded",
  },
  {
    name: "agent-loop.chain.dispatched",
    description: "Next step workflow dispatched",
  },
  {
    name: "agent-loop.chain.dispatch_failed",
    description: "Dispatch of next step failed",
  },
  {
    name: "agent-loop.chain.skipped",
    description: "Chain execution skipped (cooperative)",
  },
  {
    name: "agent-loop.chain.route_missing",
    description: "No matching outgoing edge",
  },
  {
    name: "agent-loop.chain.paused_before_dispatch",
    description: "Paused mid-execution before dispatch",
  },
  {
    name: "agent-loop.chain.stalled_before_dispatch",
    description:
      "Stalled mid-execution before dispatch (sweep landed during step)",
  },

  // Trigger
  {
    name: "agent-loop.trigger.received",
    description: "Trigger received by dispatcher",
  },
  {
    name: "agent-loop.trigger.skipped_active_run",
    description: "Trigger skipped due to active run",
  },

  // Sweep
  {
    name: "agent-loop.sweep.completed",
    description: "Sweep completed, counts emitted",
  },

  // Deferred — context merge distinct event (truncation flag is part of step.completed payload)
  {
    name: "agent-loop.context.merged",
    description: "Context merged into run (truncation flag)",
    deferred: true,
    deferredReason:
      "M1 surfaces truncation as a payload field in step.completed; a distinct context.merged event is deferred to M2 when the live view needs it as a separate timeline entry",
  },
];

describe("M1 Event Taxonomy — source-literal presence", () => {
  const sourceText = readSourceFiles() + readApiFiles();

  for (const entry of M1_TAXONOMY) {
    if (entry.deferred) {
      test.skip(`DEFERRED: "${entry.name}" — ${entry.deferredReason}`, () => {
        // skipped
      });
      continue;
    }

    test(`"${entry.name}" — ${entry.description}`, () => {
      const found = sourceText.includes(`"${entry.name}"`);
      expect(
        found,
        `Event "${entry.name}" not found as a string literal in lib/agent-loops source files. ` +
          `This event is required by the M1 taxonomy (epic #319 §10). ` +
          `Either emit it from the appropriate source file or mark it deferred with a reason.`,
      ).toBe(true);
    });
  }
});
