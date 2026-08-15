// Allow-path fixtures: "use step" functions returning plain, serializable
// data. The checker must stay green on all of these — a static guard that
// misfires on ordinary data gets deleted (docs/process/guard-integrity.md).
//
// Nothing in the Next.js app imports this file; see violations.fixture.ts
// for why it still has to be valid, type-checkable TypeScript.

export async function resolveComposioToolSlugsForRun(): Promise<{
  toolkitSlugs: string[];
  enabled: boolean;
}> {
  "use step";
  return { toolkitSlugs: ["bash", "web_fetch"], enabled: true };
}

// Built-in class-shaped values (Date) carry method-typed properties
// (getTime, toISOString, ...) that must not be mistaken for step-return
// closures — Date round-trips through the runtime's serializer natively.
export async function stepReturningDate(): Promise<{
  createdAt: Date;
  count: number;
}> {
  "use step";
  return { createdAt: new Date(), count: 1 };
}

// No explicit return-type annotation — the checker must fall back to the
// compiler's inferred return type instead of requiring an annotation.
export async function stepReturningInferredType() {
  "use step";
  return { ok: true, ids: ["a", "b"] };
}
