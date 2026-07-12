"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { SignInButton } from "@/components/auth/sign-in-button";
import { AppMockup } from "@/components/landing/app-mockup";
import { GitHubLink } from "@/components/landing/github-link";
import { LandingBento } from "@/components/landing/bento";
import { LandingFeatures } from "@/components/landing/features";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { Stage } from "@/components/landing/stage";
import { ProductJourney } from "@/components/product-journey";
import { PRODUCT_JOURNEY } from "@/lib/product-journey";

/**
 * Renders when the Vercel OAuth flow redirects back with `?error=<code>`
 * (set via `errorCallbackURL` in `SignInButton`; the code itself is a
 * better-auth-internal value like `state_mismatch` or
 * `please_restart_the_process` — deliberately not surfaced to the user, per
 * the issue's plain-language copy requirement).
 */
function SignInDidNotCompleteBanner() {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-(--l-fg)"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p>Sign-in didn&apos;t complete. Try again below.</p>
    </div>
  );
}

export function SignedOutHero() {
  const heroButtonsRef = useRef<HTMLDivElement>(null);
  const [heroButtonsVisible, setHeroButtonsVisible] = useState(true);
  const searchParams = useSearchParams();
  const signInErrorCode = searchParams.get("error");

  useEffect(() => {
    const el = heroButtonsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeroButtonsVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing relative isolate min-h-screen bg-(--l-bg) text-(--l-fg) selection:bg-(--l-fg)/20">
      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden md:block">
        <div className="mx-auto h-full max-w-[1320px] border-x border-x-(--l-border)" />
      </div>

      <div className="relative z-10">
        <LandingNav showSignIn={!heroButtonsVisible} />

        <section className="relative overflow-hidden pb-0 pt-24 md:pb-0 md:pt-44">
          <div className="mx-auto max-w-[1320px] px-6">
            <div className="max-w-[740px]">
              <h1 className="text-4xl font-semibold leading-[1.03] tracking-tighter sm:text-5xl md:text-7xl">
                Open Agents.
              </h1>
              <p className="mt-4 text-balance text-base leading-relaxed text-(--l-fg-2) sm:mt-6 sm:text-xl">
                Code in a durable cloud Session, create GitHub-triggered or
                scheduled Automations, and inspect each Run before acting on it.
              </p>
            </div>

            <div
              ref={heroButtonsRef}
              className="mt-6 flex flex-col gap-2 sm:mt-8"
            >
              <div className="flex items-center gap-2">
                <SignInButton
                  size="lg"
                  callbackUrl={PRODUCT_JOURNEY[0].href}
                />
                <GitHubLink>Open Source</GitHubLink>
              </div>
              <p className="text-xs text-(--l-fg-3)">
                Why Vercel? It&apos;s the identity provider for Open Agents —
                one account to sign in, no separate password to create.
              </p>
            </div>
            {signInErrorCode ? <SignInDidNotCompleteBanner /> : null}
            <div className="mt-10">
              <ProductJourney />
            </div>
          </div>

          <div className="mx-auto mt-12 max-w-[1320px] px-4 sm:px-6 md:mt-20 md:px-0 overflow-hidden">
            <div>
              <Stage tone="slate">
                <div className="mx-auto w-full max-w-[1160px]">
                  <AppMockup />
                </div>
              </Stage>
            </div>
          </div>
        </section>

        <LandingFeatures />
        <LandingBento />
        <LandingFooter />
      </div>
    </div>
  );
}
