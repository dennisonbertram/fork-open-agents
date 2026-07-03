import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Side-effect module: registers happy-dom globals (document, window, etc.)
 * for the *.dom.test.tsx opt-in convention. Import this (indirectly, via
 * "@/tests/dom") FIRST in any DOM-interaction test file, before any React or
 * testing-library import — see the header comment in ./index.ts for why.
 */
if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

// React 19's act() only wraps updates when this flag is set.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
