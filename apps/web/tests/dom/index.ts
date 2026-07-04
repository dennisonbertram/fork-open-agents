import "./register-dom";

import { afterEach } from "bun:test";
import { act, cleanup, fireEvent } from "@testing-library/react";

/**
 * DOM-interaction test helper barrel for the `*.dom.test.tsx` convention.
 *
 * Import this module (not "@testing-library/react" or "@testing-library/dom"
 * directly) as the FIRST import in any DOM-interaction test file, so
 * "./register-dom" runs before React/next modules are evaluated.
 *
 * IMPORTANT — this module deliberately does NOT export `screen`.
 * `screen` from @testing-library/dom binds `document` at module-evaluation
 * time. Under Bun's module hoisting, `screen`'s home module can evaluate
 * before a preceding side-effect `import "./register-dom"` has registered
 * the happy-dom globals, and `screen.getByRole(...)` then throws "a global
 * document has to be available" for the rest of the process — permanently,
 * since re-importing an already-evaluated module doesn't re-run it. Queries
 * destructured from `render()`'s return value bind lazily against that
 * render's container and do not have this problem. Use those instead of
 * `screen`. (Spike-verified failing-with-screen / passing-without on Bun
 * 1.3.14; see docs/agents/lessons-learned.md.)
 *
 * IMPORTANT — cleanup wiring. `afterEach(cleanup)` registered at this
 * barrel's own top level (i.e. at import time, inside a module that is not
 * the test file itself) does not reliably attach to the *importing* test
 * file's hook list under CI's pinned Bun 1.2.14: the hook silently no-ops,
 * so successive `render()` calls accumulate markup in `document.body` and
 * render-returned queries (bound to `baseElement=document.body`) throw
 * "Found multiple elements" once more than one test renders the same
 * markup in a file — or worse, pass by accident (CI run 28688331327, job
 * 85084963147: agent-card.dom.test.tsx failed at lines 103 and 119, 2 of 4
 * tests). Bun 1.3.14 tolerated the same code path locally, masking the bug.
 *
 * Fix: every DOM-interaction test file must call `registerDomTestHooks()`
 * itself, at its own top level (not from within this barrel, and not from
 * inside a `describe`/`test` block) — this makes the `afterEach`
 * registration happen in the test file's own module scope, where Bun
 * 1.2.14 reliably picks it up.
 */
export {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";

/**
 * Registers `afterEach(() => cleanup())` for the calling test file. MUST be
 * called at the calling file's own top level — see the header comment above
 * for why cleanup silently no-ops otherwise under Bun 1.2.14.
 */
export function registerDomTestHooks(): void {
  afterEach(() => {
    cleanup();
  });
}

/**
 * fireEvent.click wrapped in act(). Required so state updates from the
 * click handler (including ones that resolve after an awaited fetch) are
 * flushed before assertions run — under CI's pinned Bun 1.2.14, unwrapped
 * async state updates never surface to findByRole/waitFor polling.
 */
export async function userClick(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}
