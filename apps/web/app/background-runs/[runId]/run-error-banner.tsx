import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { getBackgroundRunErrorCopy } from "./error-copy";

/**
 * RunErrorBanner — a first-class, above-the-fold banner that surfaces the
 * plain-language cause of a background run's typed `errorKind` (#795).
 * Renders nothing when `errorKind` is null, so a healthy run's page is
 * unaffected. Deliberately does not replace the sidebar "Run" card's raw
 * `errorKind`/`errorMessage` text or the Debug section — both stay as-is
 * for operators; this banner is the closer-to-the-user, honest explanation.
 */
export function RunErrorBanner({ errorKind }: { errorKind: string | null }) {
  if (!errorKind) {
    return null;
  }

  const copy = getBackgroundRunErrorCopy(errorKind);

  return (
    <section
      aria-live="polite"
      className="flex items-start gap-3 rounded-md border border-red-500/25 bg-red-500/10 px-4 py-3 text-red-900 dark:text-red-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-red-700 dark:text-red-300">
          What happened
        </p>
        <p className="text-sm font-medium">{copy.whatHappened}</p>
        <p className="text-sm">
          {copy.whatToDo}
          {copy.actionHref && (
            <>
              {" "}
              <Link
                href={copy.actionHref}
                className="font-medium underline underline-offset-2"
              >
                {copy.actionLabel ?? "Learn more"}
              </Link>
            </>
          )}
        </p>
      </div>
    </section>
  );
}
