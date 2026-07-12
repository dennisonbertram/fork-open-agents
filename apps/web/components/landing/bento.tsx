import { SignInButton } from "@/components/auth/sign-in-button";
import { PRODUCT_JOURNEY } from "@/lib/product-journey";

type BentoItem = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
};

const items: readonly BentoItem[] = [
  {
    id: "001",
    title: "Connect GitHub",
    body: "Choose which repositories Open Agents may access before starting repository-scoped work.",
  },
  {
    id: "002",
    title: "Start a Session",
    body: "Work interactively with repository, branch, sandbox, and conversation context kept together.",
  },
  {
    id: "003",
    title: "Create an Automation",
    body: "Configure coding steps and start them manually, from GitHub events, or on a schedule.",
  },
  {
    id: "004",
    title: "Inspect a Run",
    body: "Review an execution attempt's status, trigger, evidence, and available recovery controls.",
  },
];

function mark(index: number) {
  if (index === 0) {
    return (
      <div className="grid grid-cols-2 gap-1" aria-hidden="true">
        <span className="size-2 border border-(--l-fg-4)" />
        <span className="size-2 border border-(--l-fg-4)" />
        <span className="size-2 border border-(--l-fg-4)" />
        <span className="size-2 border border-(--l-fg-4)" />
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span className="h-px w-4 bg-(--l-fg-4)" />
        <span className="h-px w-6 bg-(--l-fg-4)" />
        <span className="h-px w-3 bg-(--l-fg-4)" />
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="flex flex-col gap-1" aria-hidden="true">
        <span className="h-1 w-8 border border-(--l-fg-4)" />
        <span className="h-1 w-6 border border-(--l-fg-4)" />
        <span className="h-1 w-4 border border-(--l-fg-4)" />
      </div>
    );
  }
  return (
    <div className="relative h-6 w-8" aria-hidden="true">
      <span className="absolute left-0 top-0 size-2 border border-(--l-fg-4)" />
      <span className="absolute right-0 top-0 size-2 border border-(--l-fg-4)" />
      <span className="absolute bottom-0 left-1/2 size-2 -translate-x-1/2 border border-(--l-fg-4)" />
    </div>
  );
}

export function LandingBento() {
  return (
    <section>
      <div className="mx-auto max-w-[1320px] border-t border-(--l-border-subtle)">
        <div className="grid gap-6 border-b border-(--l-border) px-6 py-14 pb-10 sm:gap-10 sm:px-10 md:grid-cols-2 md:gap-0 md:pb-14 md:py-28">
          <div>
            <h2 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tighter sm:text-4xl md:text-6xl">
              A clear path
              <br />
              from idea to evidence.
            </h2>
          </div>
          <div className="md:pl-10">
            <p className="max-w-md text-balance text-base leading-relaxed text-(--l-fg-2)">
              Connect a repository, work interactively, automate repeatable
              coding tasks, and inspect what actually ran.
            </p>
            <div className="mt-6">
              <SignInButton callbackUrl={PRODUCT_JOURNEY[0].href} />
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4">
          {items.map((item, index) => (
            <article
              key={item.id}
              className={`flex h-full flex-col border-b border-(--l-border) px-6 py-8 md:px-10 md:py-9 ${
                index % 2 === 1 ? "md:border-l md:border-l-(--l-border)" : ""
              } ${index >= 2 ? "md:border-b-0" : ""} ${
                index > 0
                  ? "lg:border-l lg:border-l-(--l-border)"
                  : "lg:border-l-0"
              } lg:border-b-0`}
            >
              <div className="font-mono text-[11px] text-(--l-fg-4)">
                {item.id}
              </div>
              <div className="mt-7 flex h-10 items-center">{mark(index)}</div>
              <h3 className="mt-7 text-balance text-2xl font-semibold tracking-tighter">
                {item.title}
              </h3>
              <p className="mt-4 flex-1 text-pretty text-sm leading-relaxed text-(--l-fg-2)">
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
