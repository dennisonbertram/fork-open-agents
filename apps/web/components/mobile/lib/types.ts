/**
 * Mobile-specific types.
 * SessionWithUnread is re-exported from the SWR hook so mobile components
 * can import it from a single stable location.
 */

export type { SessionWithUnread } from "@/hooks/use-sessions";

/**
 * Tones map to semantic design-system tokens:
 *   working  -> --warning   (amber)
 *   waiting  -> --warning   (amber, different label)
 *   done     -> --success   (green)
 *   error    -> --destructive (red)
 *   idle     -> --muted     (neutral)
 */
export type MobileStatusTone =
  | "working"
  | "waiting"
  | "done"
  | "error"
  | "idle";

export interface MobileStatusDescriptor {
  label: string;
  tone: MobileStatusTone;
  /** PR number if relevant, null otherwise */
  prNumber: number | null;
}

/**
 * Filter values for the Activity filter chips.
 */
export type ActivityFilter = "all" | "working" | "waiting" | "done";
