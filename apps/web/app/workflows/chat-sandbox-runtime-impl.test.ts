/**
 * #1399 source-contract tests for chat-sandbox-runtime-impl.
 *
 * Behavior coverage for install-failure persistence and managed-runtime
 * cleanup kicks lives in `chat-sandbox-runtime.test.ts` (same module under
 * test via `resolveChatSandboxRuntime`). These checks lock the structural
 * guarantees in the impl source so a future refactor cannot silently drop
 * the finally-kick or re-couple skill installs with state persistence.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const implSource = readFileSync(
  join(import.meta.dir, "chat-sandbox-runtime-impl.ts"),
  "utf8",
);

describe("chat-sandbox-runtime-impl #1399 source contracts", () => {
  test("persists sandboxState before skill installs (no Promise.all coupling)", () => {
    const persistIdx = implSource.indexOf(
      "await updateSession(params.sessionId",
    );
    const installIdx = implSource.indexOf("Promise.allSettled([");
    expect(persistIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeLessThan(installIdx);
    expect(implSource).not.toMatch(
      /await Promise\.all\(\[\s*updateSession\(params\.sessionId/,
    );
  });

  test("kicks lifecycle cleanup in a finally block after the VM exists", () => {
    expect(implSource).toContain("} finally {");
    expect(implSource).toContain("kickSandboxLifecycleWorkflow({");
    expect(implSource).toContain(
      'event: "provisioning.cleanup_kicked_on_error"',
    );
  });
});
