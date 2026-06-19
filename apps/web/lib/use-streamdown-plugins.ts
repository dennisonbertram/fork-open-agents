"use client";

import { useEffect, useMemo, useState } from "react";

export type StreamdownPlugins =
  typeof import("./streamdown-config").streamdownPlugins;

export function hasLikelyCodeBlock(markdown: string): boolean {
  return (
    markdown.includes("```") ||
    markdown.includes("~~~") ||
    markdown.includes("<pre")
  );
}

export function useStreamdownPlugins(enabled: boolean) {
  const [plugins, setPlugins] = useState<StreamdownPlugins | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    import("./streamdown-config").then((mod) => {
      if (!cancelled) {
        setPlugins(mod.streamdownPlugins);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return useMemo(() => (enabled ? plugins : undefined), [enabled, plugins]);
}
