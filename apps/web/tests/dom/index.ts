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
 */
export {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";

afterEach(() => {
  cleanup();
});

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
