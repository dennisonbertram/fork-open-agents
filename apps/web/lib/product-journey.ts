export type ProductJourneyStep = {
  readonly id: "github" | "session" | "automation" | "run";
  readonly label: string;
  readonly description: string;
  readonly href: string;
};

export const PRODUCT_JOURNEY = [
  {
    id: "github",
    label: "Connect GitHub",
    description: "Choose the repositories Open Agents may access.",
    href: "/get-started?step=github&next=%2Fsessions",
  },
  {
    id: "session",
    label: "Start a Session",
    description:
      "Open a durable interactive workspace with repository, branch, and sandbox context.",
    href: "/sessions",
  },
  {
    id: "automation",
    label: "Create an Automation",
    description:
      "Configure manual, GitHub, or scheduled coding steps subject to permissions and readiness.",
    href: "/automations",
  },
  {
    id: "run",
    label: "Inspect a Run",
    description:
      "Review execution status, trigger, evidence, and available recovery controls.",
    href: "/runs",
  },
] as const satisfies readonly ProductJourneyStep[];
