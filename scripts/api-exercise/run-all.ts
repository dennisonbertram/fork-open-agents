/**
 * Runs every API journey suite against a server and exits non-zero if any
 * journey fails.
 *
 * This is the repeatable gate: the suites encode the API's contract as
 * observed, so a red run means a contract changed — either something broke, or
 * a defect got fixed and the expectation needs retargeting. Both are worth a
 * human look, which is why this exits non-zero rather than printing a warning.
 *
 * Not wired into `bun run ci`: it needs a live server and a database, which CI
 * does not have. Run it locally, or from a job that has both.
 */
import { formatJourneyMarkdown, runJourney } from "./journey-runner";
import { coreJourneys } from "./journeys-core";
import { extendedJourneys } from "./journeys-extended";

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3111";

async function main(): Promise<void> {
  const suites = [
    { name: "core", journeys: coreJourneys },
    { name: "extended", journeys: extendedJourneys },
  ];

  let failed = 0;
  let total = 0;
  const sections: string[] = [];

  for (const suite of suites) {
    console.log(`\n=== ${suite.name} (${suite.journeys.length} journeys) ===`);
    for (const journey of suite.journeys) {
      const result = await runJourney(journey);
      total += 1;
      if (!result.passed) {
        failed += 1;
      }
      sections.push(formatJourneyMarkdown(result));
      console.log(
        `${result.passed ? "PASS" : "FAIL"}  ${result.id}  ${result.title}`,
      );
      for (const step of result.steps.filter((s) => !s.ok)) {
        console.log(
          `        ✗ ${step.step} :: ${step.method} ${step.path} -> ${step.status}`,
        );
        console.log(
          `          ${step.responseSample.replace(/\n/g, " ").slice(0, 200)}`,
        );
      }
    }
  }

  await Bun.write(
    new URL("../../docs/api-contracts/all-journeys.md", import.meta.url)
      .pathname,
    `# API contract: all journeys\n\nObserved by running \`bun run scripts/api-exercise/run-all.ts\` against ${BASE_URL}.\n\n${sections.join("\n\n")}\n`,
  );

  console.log(
    `\n${total - failed}/${total} journeys passed against ${BASE_URL}`,
  );
  if (failed > 0) {
    console.log(
      "\nA failing journey means the API's observed contract changed. Either a\n" +
        "regression landed, or a defect was fixed and the expectation needs\n" +
        "retargeting. Both need a human decision — do not just relax the expectation.",
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
