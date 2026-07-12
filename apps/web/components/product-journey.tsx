import Link from "next/link";
import { PRODUCT_JOURNEY } from "@/lib/product-journey";
import { cn } from "@/lib/utils";

export function ProductJourney({
  dark = false,
  linked = false,
}: {
  readonly dark?: boolean;
  readonly linked?: boolean;
}) {
  return (
    <ol
      aria-label="Product journey"
      className="grid gap-px border border-current/15 sm:grid-cols-2 lg:grid-cols-4"
    >
      {PRODUCT_JOURNEY.map((step, index) => (
        <li key={step.id} className="p-4">
          <span className="text-xs tabular-nums opacity-60">{index + 1}.</span>
          {linked ? (
            <Link
              href={step.href}
              className={cn(
                "mt-2 block text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2",
                dark
                  ? "focus-visible:ring-white"
                  : "focus-visible:ring-current",
              )}
            >
              {step.label}
            </Link>
          ) : (
            <span className="mt-2 block text-sm font-semibold">
              {step.label}
            </span>
          )}
          <p className="mt-1 text-pretty text-xs leading-relaxed opacity-70">
            {step.description}
          </p>
        </li>
      ))}
    </ol>
  );
}
