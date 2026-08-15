// Synthetic "use step" functions shaped like real production breakages.
//
// Nothing in the Next.js app imports this file — it is source text that
// step-return-serializable.test.ts feeds into the checker to prove
// violations are caught. Keeping it out of the import graph keeps it out of
// `next build`'s bundle while `tsc`/`next build` type-checking still sees it
// (it matches apps/web/tsconfig.json's `**/*.ts` include), so it must stay
// valid TypeScript even though it deliberately violates the step-return
// convention.

// Mirrors the #1248 regression: resolveComposioToolsForRun returned a
// ToolSet (a record of tools holding `execute` closures) from a "use step"
// function. Every workflow run then died at step zero with
// `FatalError: Step "resolveComposioToolsForRun" exceeded max retries`.
export async function resolveComposioToolsForRun(): Promise<{
  tools: {
    bash: {
      description: string;
      execute: (input: unknown) => Promise<unknown>;
    };
  };
}> {
  "use step";
  return {
    tools: {
      bash: {
        description: "run a shell command",
        execute: (input: unknown) => Promise.resolve(input),
      },
    },
  };
}

// A function buried inside an array element.
export async function stepReturningJobList(): Promise<
  Array<{ id: string; run: () => void }>
> {
  "use step";
  return [{ id: "job-1", run: () => undefined }];
}

// A function buried inside one member of a union.
export async function stepReturningUnionHandler(): Promise<
  { kind: "label"; label: string } | { kind: "callback"; run: () => void }
> {
  "use step";
  return { kind: "label", label: "ok" };
}

// Self-referential type with a callable buried inside — proves the walker
// terminates on recursive types instead of recursing forever.
type RecursiveNode = {
  next?: RecursiveNode;
  onFire: () => void;
};
export async function stepReturningRecursiveType(): Promise<RecursiveNode> {
  "use step";
  return { onFire: () => undefined };
}
