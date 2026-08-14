import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// The registry pulls in the tool modules, which import the db layer. None of
// these are called — the contract under test is metadata, read off the tool
// definitions — but mock.module replaces the whole module, so every symbol any
// of them imports must be present or the import fails at load time.
const dbStub = {
  getSessionsWithUnreadByUserId: async () => [],
  getSessionById: async () => undefined,
  getSessionMetadataById: async () => undefined,
  getSessionDiffById: async () => undefined,
  getChatById: async () => undefined,
  getChatsBySessionId: async () => [],
  getChatSummariesBySessionId: async () => [],
  getChatMessages: async () => [],
  getRecentChatMessages: async () => [],
  countChatMessages: async () => 0,
  countSessionsByUserId: async () => 0,
};
mock.module("@/lib/db/sessions", () => dbStub);
mock.module("@/lib/sandbox/utils", () => ({ isSandboxActive: () => false }));
// #1241: get_session's lastRunOutcome lookup.
mock.module("@/lib/db/workflow-runs", () => ({
  getLatestWorkflowRunStatusBySessionId: async () => null,
}));

const registryPromise = import("./registry");

/**
 * The product name every tool must identify itself with. An agent choosing a
 * tool sees only names and descriptions, and "session" is the most overloaded
 * noun in this space — a connected client typically has its own sessions, plus
 * other servers' messages and identities. Naming the product is what makes
 * these tools selectable rather than ambiguous.
 */
const PRODUCT_NAME = "Open Agents";
const TOOL_NAME_PREFIX = "open_agents_";

/**
 * These assertions exist because the first version of this server shipped with
 * none of this metadata: no titles, no annotations, no output schemas, a
 * framework-default server name, and descriptions that never said what product
 * they operated on. A client connected, authorised, and then never called a
 * single tool. The tests below are what stop the ninth tool from shipping the
 * same way — they fail the build, not a review.
 */
describe("every registered tool carries the metadata an agent reads before acting", () => {
  test("the registry is non-empty", async () => {
    const { mcpToolRegistry } = await registryPromise;
    expect(mcpToolRegistry.length).toBeGreaterThan(0);
  });

  test("every tool name is namespaced to the product", async () => {
    const { mcpToolRegistry } = await registryPromise;
    for (const def of mcpToolRegistry) {
      expect(def.name.startsWith(TOOL_NAME_PREFIX)).toBe(true);
    }
  });

  test("every tool has a human-readable title distinct from its name", async () => {
    const { mcpToolRegistry } = await registryPromise;
    for (const def of mcpToolRegistry) {
      expect(typeof def.title).toBe("string");
      expect((def.title ?? "").trim().length).toBeGreaterThan(0);
      expect(def.title).not.toBe(def.name);
    }
  });

  test("every description names the product, so it is selectable against a client's own concepts", async () => {
    const { mcpToolRegistry } = await registryPromise;
    for (const def of mcpToolRegistry) {
      expect(def.description).toContain(PRODUCT_NAME);
    }
  });

  test("every tool declares an output schema", async () => {
    const { mcpToolRegistry } = await registryPromise;
    for (const def of mcpToolRegistry) {
      // The spec obliges a server that advertises an outputSchema to return
      // conforming structuredContent, so this is also what makes the
      // structured half of every result contractual rather than incidental.
      expect(def.outputSchema).toBeDefined();
      expect(typeof def.outputSchema?.safeParse).toBe("function");
    }
  });

  test("every tool declares annotations whose readOnlyHint matches its mutability", async () => {
    const { mcpToolRegistry } = await registryPromise;
    for (const def of mcpToolRegistry) {
      expect(def.annotations).toBeDefined();
      expect(typeof def.annotations?.readOnlyHint).toBe("boolean");

      // Per the spec, readOnlyHint defaults to false and destructiveHint
      // defaults to TRUE — so an unannotated tool is already assumed
      // destructive. The value of annotating is mostly that read-only tools
      // become recognisably safe, which only holds if the hint tracks the
      // scope that actually governs mutation.
      const isReadOnlyScope = def.scope.endsWith(":read");
      expect(def.annotations?.readOnlyHint).toBe(isReadOnlyScope);
    }
  });

  test("no tool downgrades the spec's destructive default", async () => {
    const { mcpToolRegistry } = await registryPromise;
    for (const def of mcpToolRegistry) {
      if (def.annotations?.readOnlyHint) {
        continue;
      }
      // `destructiveHint` defaults to TRUE in the spec, so writing `false` is
      // an affirmative claim that the tool cannot destroy anything — and it is
      // the claim a client checks before auto-approving without confirmation.
      // Every write tool here ends in an agent run that inherits the user's
      // auto-commit/auto-PR settings and can delete files and push a branch,
      // so `false` would be a lie that unlocks unattended destructive work.
      expect(def.annotations?.destructiveHint).toBe(true);
    }
  });

  test("a tool that can mutate declares whether repeating it is safe", async () => {
    const { mcpToolRegistry } = await registryPromise;
    for (const def of mcpToolRegistry) {
      if (def.annotations?.readOnlyHint) {
        continue;
      }
      // A caller retrying after a timeout needs to know whether a second call
      // duplicates the effect — for a tool that spends money, that is the
      // difference between one run and two.
      expect(typeof def.annotations?.idempotentHint).toBe("boolean");
    }
  });
});

/**
 * The description/schema coherence check.
 *
 * `start_session`'s description told callers to poll `get_session` until it
 * reported `ready` / `sandboxProvisioning`. Neither field existed on that
 * result, so an agent following the instruction literally would loop forever.
 * Nothing caught it: the description is prose, and prose is not typechecked.
 *
 * This makes it checkable. Any field name a description mentions in backticks
 * must exist in some tool's output schema, so documentation cannot drift from
 * the payload it describes.
 */
/**
 * Collect every field name and every enum value a schema can produce, walking
 * through arrays, optionals and nested objects.
 *
 * Values matter as much as names here: a description promising a `stalled`
 * workspace, or telling a caller to poll until `ready`, is just as unactionable
 * when the enum does not offer it as a field name that does not exist.
 */
function collectSchemaVocabulary(
  schema: unknown,
  into: Set<string>,
  depth = 0,
): void {
  if (!schema || typeof schema !== "object" || depth > 8) {
    return;
  }
  const node = schema as {
    shape?: Record<string, unknown>;
    options?: unknown;
    element?: unknown;
    unwrap?: () => unknown;
  };

  if (Array.isArray(node.options)) {
    for (const option of node.options) {
      if (typeof option === "string") {
        into.add(option);
      }
    }
  }
  for (const [key, child] of Object.entries(node.shape ?? {})) {
    into.add(key);
    collectSchemaVocabulary(child, into, depth + 1);
  }
  if (node.element) {
    collectSchemaVocabulary(node.element, into, depth + 1);
  }
  if (typeof node.unwrap === "function") {
    collectSchemaVocabulary(node.unwrap(), into, depth + 1);
  }
}

describe("descriptions only reference fields that exist", () => {
  test("every backticked identifier in a description is a real output field", async () => {
    const { mcpToolRegistry } = await registryPromise;

    const knownFields = new Set<string>();
    for (const def of mcpToolRegistry) {
      collectSchemaVocabulary(def.outputSchema, knownFields);
      // Input fields are legitimate to reference too ("omit `chatId` to…").
      collectSchemaVocabulary(def.inputSchema, knownFields);
    }
    // Tool names are also legitimate backticked references.
    for (const def of mcpToolRegistry) {
      knownFields.add(def.name);
    }

    const problems: string[] = [];
    for (const def of mcpToolRegistry) {
      const referenced = [...def.description.matchAll(/`([A-Za-z_][\w.]*)`/g)]
        .map((match) => match[1] as string)
        // Dotted paths refer to a nested field; check the root only.
        .map((token) => token.split(".")[0] as string);

      for (const token of referenced) {
        if (!knownFields.has(token)) {
          problems.push(`${def.name}: \`${token}\``);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
