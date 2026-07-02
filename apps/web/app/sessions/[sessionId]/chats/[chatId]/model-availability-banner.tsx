import { AlertTriangle, RefreshCw, Settings2 } from "lucide-react";
import Link from "next/link";
import type { ModelsErrorKind } from "./get-initial-models";

export interface ModelAvailabilityBannerProps {
  errorKind: ModelsErrorKind | null;
  hasModels: boolean;
}

/**
 * Renders nothing when at least one model is available. Otherwise renders a
 * blocking-but-not-crashing banner distinguishing "we couldn't check
 * available models" (fetch threw — recoverable, offers retry) from "no
 * models are configured yet" (fetch succeeded with zero models — a
 * configuration state; retrying will not help).
 */
export function ModelAvailabilityBanner({
  errorKind,
  hasModels,
}: ModelAvailabilityBannerProps) {
  if (hasModels) {
    return null;
  }

  if (errorKind === "fetch_failed") {
    return (
      <div
        role="alert"
        className="mb-4 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-red-200"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
        <div className="space-y-1.5">
          <p className="text-sm font-medium">
            We couldn&apos;t check available models
          </p>
          <p className="text-xs opacity-90">
            Something went wrong while loading the model list, so sending a
            message may fail. Check your model settings or try again.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/settings/models"
              className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 hover:opacity-80"
            >
              <Settings2 className="size-3" />
              Go to model settings
            </Link>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full page reload to re-run the server-side models fetch, not a Next.js page navigation */}
            <a
              href="."
              className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 hover:opacity-80"
            >
              <RefreshCw className="size-3" />
              Retry
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-200"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <div className="space-y-1.5">
        <p className="text-sm font-medium">No models are configured yet</p>
        <p className="text-xs opacity-90">
          This workspace doesn&apos;t have any language models available. Add a
          model or inference profile to start chatting.
        </p>
        <Link
          href="/settings/models"
          className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 hover:opacity-80"
        >
          <Settings2 className="size-3" />
          Go to model settings
        </Link>
      </div>
    </div>
  );
}
