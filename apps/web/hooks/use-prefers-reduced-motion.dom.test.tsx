import { registerDomTestHooks, render, within } from "@/tests/dom";
import { describe, expect, test } from "bun:test";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

registerDomTestHooks();

function Probe() {
  const reduced = usePrefersReducedMotion();
  return <output>{reduced === null ? "unknown" : reduced ? "reduced" : "full"}</output>;
}

describe("usePrefersReducedMotion", () => {
  test("starts static and resolves matchMedia reduce without an animated false frame", () => {
    window.matchMedia = () =>
      ({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList;
    const { container } = render(<Probe />);
    expect(["unknown", "reduced"]).toContain(within(container).getByRole("status").textContent);
    expect(container.textContent).not.toContain("full");
  });
});
