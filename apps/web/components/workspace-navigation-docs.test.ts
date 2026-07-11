import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "../../../");
const plan = readFileSync(join(root, "PLAN.md"), "utf8");
const durablePlan = readFileSync(
  join(root, "docs/plans/sessions-automations-runs.md"),
  "utf8",
);
const destinationOrder = [
  "Sessions",
  "Runs",
  "Automations",
  "Repositories",
  "Settings",
];

function numberedBoldItems(section: string): string[] {
  return Array.from(section.matchAll(/^\d+\. \*\*([^*]+)\*\*/gm), (match) =>
    match[1]?.trim(),
  ).filter((item): item is string => Boolean(item));
}

describe("workspace navigation planning contract (#961)", () => {
  test("the root Product Contract names all five surfaces in visible order", () => {
    const productContract = plan.split("## Product Contract")[1]?.split("## System Impact")[0] ?? "";
    expect(numberedBoldItems(productContract)).toEqual(destinationOrder);
  });

  test("the durable Purpose names all five surfaces in visible order", () => {
    const purpose = durablePlan.split("## Purpose")[1]?.split("## Decision Summary")[0] ?? "";
    expect(numberedBoldItems(purpose)).toEqual(destinationOrder);
  });

  test("the target IA exposes five peers without promoting Workspace", () => {
    const informationArchitecture =
      durablePlan
        .split("## Target Information Architecture")[1]
        ?.split("## Canonical Contracts")[0] ?? "";
    const topLevelItems = Array.from(
      informationArchitecture.matchAll(/^(?:├──|└──) ([^\n]+)$/gm),
      (match) => match[1]?.trim(),
    ).filter((item): item is string => Boolean(item));

    expect(topLevelItems).toEqual(destinationOrder);
    expect(topLevelItems).not.toContain("Workspace");
  });

  test("documents execution nouns separately from context and configuration", () => {
    expect(plan).toContain(
      "Sessions, Automations, and Runs are the only default execution nouns.",
    );
    expect(plan).toContain(
      "Repositories is the top-level context directory; Settings owns supporting configuration.",
    );
  });
});
