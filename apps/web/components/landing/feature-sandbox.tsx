"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

const sequence = [
  { state: "provisioning", ms: 1400 },
  { state: "active", ms: 2400 },
  { state: "hibernating", ms: 1200 },
  { state: "hibernated", ms: 2000 },
  { state: "restoring", ms: 1200 },
  { state: "active", ms: 2400 },
] as const;

type State = (typeof sequence)[number]["state"];

const descriptions: Record<State, string> = {
  provisioning: "spinning up isolated environment",
  active: "full filesystem, network, runtime access",
  hibernating: "creating a snapshot for later recovery",
  hibernated: "zero compute \u00B7 snapshot saved",
  restoring: "restoring from snapshot",
};

export function FeatureSandbox() {
  const reducedMotion = usePrefersReducedMotion();
  const [idx, setIdx] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entry = reducedMotion === false ? sequence[idx]! : sequence[1]!;

  const advance = useCallback(() => {
    setIdx((prev) => {
      const next = prev + 1;
      return next >= sequence.length ? 0 : next;
    });
  }, []);

  useEffect(() => {
    if (reducedMotion !== false) return;
    timeoutRef.current = setTimeout(advance, entry.ms);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [idx, entry.ms, advance, reducedMotion]);

  return (
    <div className="flex h-[280px] flex-col bg-(--l-code-bg)">
      <div className="flex-1 px-5 py-4">
        <p className="mb-3 text-[10px] text-(--l-panel-fg-4)">
          Illustrative example
        </p>
        <div className="flex items-center gap-3 font-mono text-[12px]">
          <span className="text-(--l-panel-fg-3)">sandbox</span>
          <span className="text-(--l-panel-fg-2)">feat/auth</span>
        </div>

        <div className="mt-6 flex gap-1">
          {sequence.map((_, i) => (
            <div
              key={i}
              className="h-px flex-1 transition-all duration-700"
              style={{
                backgroundColor:
                  i === idx
                    ? "var(--l-panel-fg-2)"
                    : i < idx
                      ? "var(--l-panel-fg-4)"
                      : "var(--l-panel-fg-5)",
              }}
            />
          ))}
        </div>

        <div className="mt-5">
          <div className="font-mono text-[13px] text-(--l-panel-fg)">
            {entry.state}
          </div>
          <div className="mt-1 text-[11px] text-(--l-panel-fg-3)">
            {descriptions[entry.state]}
          </div>
        </div>

        <div className="mt-8 flex gap-8 font-mono text-[10px]">
          <div>
            <div className="text-(--l-panel-fg-4)">branch</div>
            <div className="mt-0.5 text-(--l-panel-fg-2)">feat/auth</div>
          </div>
          <div>
            <div className="text-(--l-panel-fg-4)">snapshot</div>
            <div className="mt-0.5 text-(--l-panel-fg-2)">
              {entry.state === "hibernated" || entry.state === "restoring"
                ? "snap_a1b2c3"
                : "\u2014"}
            </div>
          </div>
          <div>
            <div className="text-(--l-panel-fg-4)">cost</div>
            <div className="mt-0.5 text-(--l-panel-fg-2)">varies by usage</div>
          </div>
        </div>
      </div>
    </div>
  );
}
