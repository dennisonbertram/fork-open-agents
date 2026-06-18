import {
  submitNewAgent,
  updateExistingAgent,
  type CreateAgentResult,
} from "./create-agent-request";

type SaveDeps = {
  submit?: typeof submitNewAgent;
  update?: typeof updateExistingAgent;
};

/**
 * Routes a save from the /agents/new builder.
 *
 * The builder stays on the page after the first successful create (so
 * "Run a test" works). A re-save must NOT create a second agent — that
 * duplicates the agent and orphans the first. So:
 *   - no existing id  -> POST (create) via submitNewAgent
 *   - existing id     -> PATCH (update in place) via updateExistingAgent
 *
 * Pure and framework-free: the builder owns React state and only passes the
 * current `createdAgentId`. Deps are injectable for tests.
 */
export async function saveAgentSpec(
  createdAgentId: string | null,
  payload: unknown,
  deps: SaveDeps = {},
): Promise<CreateAgentResult> {
  const submit = deps.submit ?? submitNewAgent;
  const update = deps.update ?? updateExistingAgent;

  if (createdAgentId) {
    return update(createdAgentId, payload);
  }
  return submit(payload);
}
