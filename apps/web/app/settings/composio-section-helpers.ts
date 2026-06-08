/**
 * Pure helper functions for Composio section UX logic.
 * Extracted so they can be unit-tested independently of React.
 */
import type { ComposioAgentKey } from "@/lib/composio/types";

// ── profileRowSummary ──────────────────────────────────────────────────────

/** Maximum number of logos shown in the collapsed profile row before overflow. */
export const MAX_VISIBLE_LOGOS = 5;

/** A single logo entry for the collapsed profile row. */
export interface ProfileLogoEntry {
  slug: string;
  /** Display name — from catalog when available, otherwise prettified slug. */
  name: string;
  /** Remote logo URL, or null when the toolkit has no logo / is unknown. */
  logo: string | null;
}

/** Minimal catalog shape required by the helper. */
interface CatalogEntry {
  slug: string;
  name: string;
  logo: string | null;
}

/**
 * Derive the visible logo strip + overflow count for a collapsed profile row.
 *
 * - Returns up to MAX_VISIBLE_LOGOS entries from the profile's toolkit slugs.
 * - Entries absent from the catalog fall back to a null logo and the raw slug
 *   as the name.
 * - `overflow` is the number of toolkits that exceed the visible cap.
 */
export function profileRowSummary(
  toolkitSlugs: string[],
  catalog: CatalogEntry[],
): { logos: ProfileLogoEntry[]; overflow: number } {
  const bySlug = new Map<string, CatalogEntry>(catalog.map((t) => [t.slug, t]));

  const logos: ProfileLogoEntry[] = toolkitSlugs
    .slice(0, MAX_VISIBLE_LOGOS)
    .map((slug) => {
      const entry = bySlug.get(slug);
      return {
        slug,
        name: entry?.name ?? slug,
        logo: entry?.logo ?? null,
      };
    });

  const overflow = Math.max(0, toolkitSlugs.length - MAX_VISIBLE_LOGOS);

  return { logos, overflow };
}

/**
 * Determines whether the toolkit search results dropdown should be visible.
 *
 * Rules:
 * - Visible when the input is focused (user is actively interacting)
 * - Visible when the query has non-whitespace content (results are relevant)
 * - Hidden otherwise (collapsed by default — no always-open scroll box)
 */
export function shouldShowResults(isFocused: boolean, query: string): boolean {
  if (isFocused) return true;
  return query.trim().length > 0;
}

/**
 * Whether to show the "Tip: set a default profile for Main" hint.
 *
 * Shows when:
 * - At least one profile exists (there's something to assign)
 * - Main agent has no default profile set (the tip is actionable)
 */
export function shouldShowMainDefaultTip(
  profiles: ReadonlyArray<{ id: string }>,
  mainDefaultProfileId: string | null,
): boolean {
  return profiles.length > 0 && mainDefaultProfileId === null;
}

/**
 * One-line description for each agent role shown as tooltip/subtext in
 * the compact agent defaults row.
 */
export const AGENT_ROLE_DESCRIPTIONS: Record<ComposioAgentKey, string> = {
  main: "The main chat agent — handles top-level tasks and conversations.",
  explorer: "Subagent that researches and maps out solutions before acting.",
  executor:
    "Subagent that carries out concrete actions (file edits, API calls).",
  design: "Subagent focused on design-related tasks and visual output.",
};
