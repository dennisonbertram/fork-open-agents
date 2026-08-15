import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  findStepReturnViolations,
  type StepReturnViolation,
} from "./step-return-serializable";
import { resolveKnownPreExistingViolations } from "./step-return-serializable-baseline";

const FIXTURES_DIR = path.join(import.meta.dir, "__fixtures__");
const WORKFLOWS_DIR = path.join(
  import.meta.dir,
  "..",
  "..",
  "app",
  "workflows",
);

function violationsIn(fileName: string): StepReturnViolation[] {
  return findStepReturnViolations([path.join(FIXTURES_DIR, fileName)]);
}

function realWorkflowStepFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .map((name) => path.join(WORKFLOWS_DIR, name));
}

describe("findStepReturnViolations — regression coverage", () => {
  // If a future edit to the visited-set or the max-depth bound in
  // step-return-serializable.ts breaks termination, this self-referential
  // type would either hang the checker or silently stop walking before it
  // reaches the callable member. This fails (timeout or a missing hit) if
  // either regresses.
  test("terminates on a recursive type and still finds the buried callable", () => {
    const violations = violationsIn("violations.fixture.ts");
    const hit = violations.find(
      (v) => v.functionName === "stepReturningRecursiveType",
    );

    expect(hit).toBeDefined();
    expect(hit?.propertyPath).toBe("onFire");
  });

  // Property/index iteration order from the TypeScript checker, or Set
  // iteration order in the visited tracker, could in principle vary run to
  // run. This pins that they don't: two independent Program instances built
  // from the same source must report the same violations. If the checker
  // starts depending on unstable iteration order, this catches it as a
  // reliable failure instead of an intermittent CI flake.
  test("is deterministic across repeated runs on the same input", () => {
    const first = violationsIn("violations.fixture.ts");
    const second = violationsIn("violations.fixture.ts");

    expect(second).toEqual(first);
  });

  // The chat.ts "writer" gap (see step-return-serializable-baseline.ts) is
  // tracked as a known baseline instead of being silently allowlisted. If it
  // disappears from the checker's output without the baseline being edited,
  // either someone fixed chat.ts (update the baseline) or the checker
  // regressed and stopped detecting it (a real bug). Either way this must
  // fail loudly instead of the baseline silently going stale.
  test("the known pre-existing baseline is still detected", () => {
    const violations = findStepReturnViolations(realWorkflowStepFiles());
    const known = resolveKnownPreExistingViolations(WORKFLOWS_DIR);

    for (const expectedViolation of known) {
      expect(violations).toContainEqual(expectedViolation);
    }
  });
});
