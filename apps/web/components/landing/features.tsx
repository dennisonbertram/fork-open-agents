"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FeatureAgent } from "./feature-agent";
import { FeatureSandbox } from "./feature-sandbox";
import { FeatureWorkflow } from "./feature-workflow";
import { Stage, type StageTone } from "./stage";
import { Window } from "./window";

function Spotlight({
  tone,
  title,
  description,
  bullets,
  flip,
  window: windowContent,
}: {
  readonly tone: StageTone;
  readonly title: string;
  readonly description: string;
  readonly bullets: readonly string[];
  readonly flip?: boolean;
  readonly window: ReactNode;
}) {
  return (
    <div className="grid items-center md:grid-cols-2">
      <div
        className={cn(
          "px-6 py-16 sm:px-10 md:py-20 lg:py-24",
          flip ? "order-1 md:order-2" : "order-1 md:order-1",
        )}
      >
        <h2 className="text-balance text-2xl font-semibold tracking-tighter sm:text-3xl md:text-4xl">
          {title}
        </h2>
        <p className="mt-4 text-balance text-base leading-relaxed text-(--l-fg-2) sm:mt-5 sm:text-lg">
          {description}
        </p>
        <ul className="mt-4 space-y-3 sm:mt-5">
          {bullets.map((b) => (
            <li
              key={b}
              className="flex items-center gap-3 text-(--l-fg-2) sm:text-lg"
            >
              <span className="h-1.5 w-1.5 bg-(--l-fg-2)" />
              {b}
            </li>
          ))}
        </ul>
      </div>

      <div
        className={flip ? "order-2 md:order-1 -mr-px" : "order-2 md:order-2"}
      >
        <Stage tone={tone}>
          <div className="mx-auto w-full max-w-[1160px]">
            <Window>{windowContent}</Window>
          </div>
        </Stage>
      </div>
    </div>
  );
}

export function LandingFeatures() {
  return (
    <section>
      <div className="relative mx-auto max-w-[1320px] overflow-hidden">
        <div
          className="absolute left-1/2 top-0 hidden h-full w-px md:block"
          style={{ backgroundColor: "var(--l-border)" }}
        />
        <div>
          <Spotlight
            tone="slate"
            title="Start a durable coding Session."
            description="A Session keeps repository, branch, sandbox, and conversation context together while you direct and review the coding work."
            bullets={[
              "File ops, search, shell, and task delegation built in",
              "Helper roles can explore and implement scoped work",
              "Choose from configured models",
            ]}
            window={<FeatureAgent />}
          />

          <Spotlight
            tone="ash"
            title="Cloud sandboxes, not local machines."
            description="Every session runs in an isolated Vercel sandbox with its own branch. Changes stay on that branch until you commit — turn on auto commit & push in Settings if you'd rather it happen automatically."
            bullets={[
              "Ephemeral environments with full git integration",
              "Inactivity can hibernate the sandbox; snapshots support recovery",
              "Snapshot and restore filesystem state",
            ]}
            flip
            window={<FeatureSandbox />}
          />

          <Spotlight
            tone="iron"
            title="Create an Automation, then inspect its Run."
            description="Automations coordinate configured coding steps and triggers. Each attempt creates an inspectable Run with status and available evidence."
            bullets={[
              "Manual, GitHub webhook, and scheduled triggers",
              "Configured permissions and readiness gates apply",
              "Run history exposes status, evidence, and recovery controls",
            ]}
            window={<FeatureWorkflow />}
          />
        </div>
      </div>
    </section>
  );
}
