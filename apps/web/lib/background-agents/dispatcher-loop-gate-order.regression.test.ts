/**
 * Regression pin for #762: "No dispatcher changes in this ticket."
 *
 * dispatcher.ts already branches on `trigger.loopId` at three call sites
 * (dispatchBackgroundTriggerEvent, dispatchWebhookErrorEvent,
 * dispatchScheduledBackgroundAgents) BEFORE dereferencing `row.agent` /
 * `match.agent`, since a loop-bound trigger row has agentId=null and a null
 * agent must never be dereferenced on that branch (see #326).
 *
 * This ticket adds trigger CRUD routes/UI on TOP of the existing dispatcher —
 * it must not reorder or remove these gates. Rather than re-mocking the full
 * dispatcher harness (see dispatcher-loop-integration.test.ts for the
 * behavioral coverage), this is a lightweight structural pin: it parses the
 * three exported dispatch functions and asserts the `trigger.loopId` /
 * `row.trigger.loopId` check textually precedes the first `.agent` /
 * `match.agent` dereference within each function body.
 *
 * If a future change reorders this gate (dereferencing agent before checking
 * loopId), this test fails loudly instead of silently reintroducing #326.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dispatcherSource = readFileSync(
  join(import.meta.dir, "dispatcher.ts"),
  "utf8",
);

/**
 * Extracts the body of a top-level exported async function by name using
 * brace counting (good enough for this file's structure — no nested
 * functions with the same name).
 *
 * The function body's opening "{" is found AFTER the parameter list's
 * closing ")" (skipping any return-type annotation) — the params themselves
 * commonly use an inline `{ ... }` object-type annotation whose braces would
 * otherwise be mistaken for the body.
 */
function extractFunctionBody(source: string, functionName: string): string {
  const marker = `export async function ${functionName}(`;
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) {
    throw new Error(`Could not find function ${functionName} in dispatcher.ts`);
  }

  let parenDepth = 0;
  let parenEnd = startIdx + marker.length - 1; // position of the opening "("
  for (; parenEnd < source.length; parenEnd++) {
    if (source[parenEnd] === "(") parenDepth++;
    if (source[parenEnd] === ")") {
      parenDepth--;
      if (parenDepth === 0) break;
    }
  }

  const bodyStart = source.indexOf("{", parenEnd);
  let depth = 0;
  let i = bodyStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(bodyStart, i + 1);
}

function firstIndexOfAny(body: string, needles: string[]): number {
  const indices = needles
    .map((n) => body.indexOf(n))
    .filter((idx) => idx !== -1);
  return indices.length > 0 ? Math.min(...indices) : -1;
}

describe("dispatcher.ts — loopId-before-agent gate order (#762 regression pin)", () => {
  test("dispatchBackgroundTriggerEvent checks trigger.loopId before dereferencing match.agent", () => {
    const body = extractFunctionBody(
      dispatcherSource,
      "dispatchBackgroundTriggerEvent",
    );
    const loopIdCheckIdx = body.indexOf("match.trigger.loopId");
    const agentDerefIdx = firstIndexOfAny(body, ["const agent = match.agent"]);
    expect(loopIdCheckIdx).toBeGreaterThan(-1);
    expect(agentDerefIdx).toBeGreaterThan(-1);
    expect(loopIdCheckIdx).toBeLessThan(agentDerefIdx);
  });

  test("dispatchWebhookErrorEvent checks row.trigger.loopId before dereferencing row.agent", () => {
    const body = extractFunctionBody(
      dispatcherSource,
      "dispatchWebhookErrorEvent",
    );
    const loopIdCheckIdx = body.indexOf("row.trigger.loopId");
    const agentDerefIdx = firstIndexOfAny(body, ["const agent = row.agent"]);
    expect(loopIdCheckIdx).toBeGreaterThan(-1);
    expect(agentDerefIdx).toBeGreaterThan(-1);
    expect(loopIdCheckIdx).toBeLessThan(agentDerefIdx);
  });

  test("dispatchScheduledBackgroundAgents checks row.trigger.loopId before dereferencing row.agent in both loop passes", () => {
    const body = extractFunctionBody(
      dispatcherSource,
      "dispatchScheduledBackgroundAgents",
    );
    // First pass: allowlist/validation loop — `if (!row.trigger.loopId)` gates
    // the agent-bound branch that dereferences `const agent = row.agent`.
    const firstPassGateIdx = body.indexOf("if (!row.trigger.loopId)");
    const firstPassAgentDerefIdx = body.indexOf("const agent = row.agent");
    expect(firstPassGateIdx).toBeGreaterThan(-1);
    expect(firstPassAgentDerefIdx).toBeGreaterThan(-1);
    expect(firstPassGateIdx).toBeLessThan(firstPassAgentDerefIdx);

    // Second pass: dispatch loop — `if (row.trigger.loopId)` branches to the
    // loop path before the agent-bound `const agent = row.agent` below it.
    const secondPassGateIdx = body.indexOf(
      "if (row.trigger.loopId) {",
      firstPassAgentDerefIdx,
    );
    const secondPassAgentDerefIdx = body.indexOf(
      "const agent = row.agent",
      secondPassGateIdx,
    );
    expect(secondPassGateIdx).toBeGreaterThan(-1);
    expect(secondPassAgentDerefIdx).toBeGreaterThan(-1);
    expect(secondPassGateIdx).toBeLessThan(secondPassAgentDerefIdx);
  });
});
