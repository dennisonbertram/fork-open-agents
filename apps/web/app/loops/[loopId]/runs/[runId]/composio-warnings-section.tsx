"use client";

/**
 * #798 — agent-loop run detail parity for Composio degradation visibility.
 * Renders the warnings derived by deriveLoopComposioWarnings as a visually
 * distinct block, matching the background-agent run-summary-section.tsx
 * "Warnings" block (same accessible-text standard, same amber treatment,
 * distinct from the red error banner used for run-level failures).
 */
export function ComposioWarningsSection({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <section className="rounded-md border border-amber-500/25 bg-amber-500/10 p-4">
      <p className="text-[10px] font-medium uppercase text-amber-700 dark:text-amber-300">
        Warnings
      </p>
      <ul className="mt-1.5 space-y-1">
        {warnings.map((warning, i) => (
          <li key={i} className="text-sm text-amber-800 dark:text-amber-200">
            {warning}
          </li>
        ))}
      </ul>
    </section>
  );
}
