import Link from "next/link";
import { PRODUCT_JOURNEY } from "@/lib/product-journey";
import { ThemeToggle } from "./theme-toggle";

export function LandingFooter() {
  return (
    <footer>
      <div className="mx-auto max-w-[1320px] md:border-t md:border-(--l-border)">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          <div className="px-6 pt-14 md:px-10 md:py-18">
            <div className="font-mono text-xs uppercase tracking-widest text-(--l-fg-3)">
              Open Agents
            </div>
            <div className="mt-3 text-sm text-(--l-fg-2)">
              Open Agents for
              <br />
              shipping code.
            </div>
          </div>

          <div className="hidden lg:block" />

          <div className="px-6 pt-14 md:px-10 md:py-18">
            <div className="font-mono text-xs uppercase tracking-widest text-(--l-fg-3)">
              Journey
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Link
                href={PRODUCT_JOURNEY[0].href}
                className="font-sans text-sm text-(--l-fg-2) transition-colors hover:text-(--l-fg)"
              >
                Connect GitHub
              </Link>
              <Link
                href="/sessions"
                className="font-sans text-sm text-(--l-fg-2) transition-colors hover:text-(--l-fg)"
              >
                Sessions
              </Link>
              <Link
                href="/automations"
                className="font-sans text-sm text-(--l-fg-2) transition-colors hover:text-(--l-fg)"
              >
                Automations
              </Link>
              <Link
                href="/runs"
                className="font-sans text-sm text-(--l-fg-2) transition-colors hover:text-(--l-fg)"
              >
                Runs
              </Link>
            </div>
          </div>

          <div className="px-6 pt-14 md:px-10 md:py-18">
            <div className="font-mono text-xs uppercase tracking-widest text-(--l-fg-3)">
              Links
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <a
                href="https://github.com/dennisonbertram/fork-open-agents"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-(--l-fg-2) transition-colors hover:text-(--l-fg)"
              >
                GitHub
              </a>
              <a
                href="https://vercel.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-(--l-fg-2) transition-colors hover:text-(--l-fg)"
              >
                Vercel
              </a>
              <a
                href="https://ai-sdk.dev/docs/introduction"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-(--l-fg-2) transition-colors hover:text-(--l-fg)"
              >
                AI SDK Docs
              </a>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 pt-6 pb-6 md:pt-0 md:px-10 md:pb-10">
          <a
            href="https://vercel.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-(--l-fg)"
          >
            <svg
              viewBox="0 0 76 65"
              className="h-4"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
            </svg>
          </a>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
