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

describe("findStepReturnViolations", () => {
  test("flags a ToolSet-shaped return the way #1248 broke production", () => {
    const violations = violationsIn("violations.fixture.ts");
    const hit = violations.find(
      (v) => v.functionName === "resolveComposioToolsForRun",
    );

    expect(hit).toBeDefined();
    expect(hit?.propertyPath).toBe("tools.bash.execute");
  });

  test("flags a function buried inside an array element", () => {
    const violations = violationsIn("violations.fixture.ts");
    const hit = violations.find(
      (v) => v.functionName === "stepReturningJobList",
    );

    expect(hit).toBeDefined();
    expect(hit?.propertyPath).toBe("[0].run");
  });

  test("flags a function buried inside one union member", () => {
    const violations = violationsIn("violations.fixture.ts");
    const hit = violations.find(
      (v) => v.functionName === "stepReturningUnionHandler",
    );

    expect(hit).toBeDefined();
    expect(hit?.propertyPath).toBe("run");
  });

  test("allow path: plain serializable data is never flagged", () => {
    const violations = violationsIn("clean.fixture.ts");

    expect(
      violations.filter(
        (v) => v.functionName === "resolveComposioToolSlugsForRun",
      ),
    ).toEqual([]);
  });

  test("allow path: Date fields are not mistaken for closures", () => {
    const violations = violationsIn("clean.fixture.ts");

    expect(
      violations.filter((v) => v.functionName === "stepReturningDate"),
    ).toEqual([]);
  });

  test("allow path: inferred (unannotated) return types are checked too", () => {
    const violations = violationsIn("clean.fixture.ts");

    expect(
      violations.filter((v) => v.functionName === "stepReturningInferredType"),
    ).toEqual([]);
  });

  // Discovered by writing this guard, not caused by it — see
  // step-return-serializable-baseline.ts for the full explanation of the
  // one pre-existing chat.ts gap this guard found (fixing it means editing
  // chat.ts, which is out of scope here). This asserts everything else in
  // the tree is clean; step-return-serializable.regression.test.ts asserts
  // the baseline itself only ever shrinks.
  test("the real apps/web/app/workflows tree has no NEW violations today", () => {
    const violations = findStepReturnViolations(realWorkflowStepFiles());
    const known = resolveKnownPreExistingViolations(WORKFLOWS_DIR);
    const isKnown = (v: StepReturnViolation) =>
      known.some(
        (k) =>
          k.functionName === v.functionName &&
          k.filePath === v.filePath &&
          k.propertyPath === v.propertyPath,
      );

    expect(violations.filter((v) => !isKnown(v))).toEqual([]);
  });
});
