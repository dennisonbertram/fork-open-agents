"use client";

import { MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileScreenHeader } from "@/components/mobile/shell/mobile-screen-header";
import { MobileStatusPill } from "@/components/mobile/shell/mobile-status-pill";
import type { MobileStatusDescriptor } from "@/components/mobile/lib/types";

export interface MobileChatHeaderProps {
  /** Session title shown as the primary heading */
  title: string;
  /**
   * Repository label, e.g. "owner/repo".
   * Displayed as the subtitle; null for chat-only sessions.
   */
  repoLabel: string | null;
  /**
   * Branch name.
   * When both repoLabel and branch are present the subtitle renders as
   * "repoLabel @ branch"; otherwise just repoLabel.
   */
  branch: string | null;
  /** Status descriptor produced by deriveMobileStatus */
  status: MobileStatusDescriptor;
  /** Called when the user taps the back chevron — required for the chat route */
  onBack: () => void;
  /**
   * Called when the user taps the overflow (⋮) icon.
   * Pass null (or omit) to hide the button.
   */
  onOverflow?: (() => void) | null;
}

/**
 * Sticky header for the mobile chat route.
 *
 * Composes MobileScreenHeader with:
 * - A status pill in the trailing slot (via MobileStatusPill)
 * - An optional overflow icon button (MoreVertical)
 *
 * Clears the iOS notch via MobileScreenHeader's safe-area-inset-top padding.
 * Both back and overflow buttons satisfy the >=44px touch-target requirement.
 */
export function MobileChatHeader({
  title,
  repoLabel,
  branch,
  status,
  onBack,
  onOverflow,
}: MobileChatHeaderProps) {
  // Combine repo + branch into a single subtitle string
  const subtitle =
    repoLabel && branch ? `${repoLabel} @ ${branch}` : (repoLabel ?? undefined);

  const trailing = (
    <div className="flex items-center gap-1">
      <MobileStatusPill descriptor={status} size="sm" />
      {onOverflow ? (
        <Button
          variant="ghost"
          size="icon"
          className="min-h-[44px] min-w-[44px] rounded-full"
          onClick={onOverflow}
          aria-label="More options"
        >
          <MoreVertical className="h-5 w-5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );

  return (
    <MobileScreenHeader
      title={title}
      subtitle={subtitle}
      onBack={onBack}
      trailing={trailing}
    />
  );
}
