import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionsShellProvider } from "@/app/sessions/sessions-shell-context";
import { RepositoryDashboardView } from "./repository-dashboard-view";

function renderDashboard(
  props: React.ComponentProps<typeof RepositoryDashboardView>,
) {
  return renderToStaticMarkup(
    <SessionsShellProvider value={{ openNewSessionDialog: () => undefined }}>
      <RepositoryDashboardView {...props} />
    </SessionsShellProvider>,
  );
}

describe("RepositoryDashboardView", () => {
  test("renders the four primary destinations in order with shipped filters", () => {
    const html = renderDashboard({
      owner: "Acme Org+β",
      repo: "widgets & api",
      summary: {
        automations: { status: "ready", count: 4 },
        runs: { status: "partial", count: 2 },
      },
    });

    const newSession = html.indexOf("New Session");
    const automations = html.indexOf(">Automations<");
    const runs = html.indexOf(">Runs<");
    const github = html.indexOf(">GitHub<");
    expect(newSession).toBeGreaterThan(-1);
    expect(newSession).toBeLessThan(automations);
    expect(automations).toBeLessThan(runs);
    expect(runs).toBeLessThan(github);

    expect(html).toContain(
      'href="/automations?repository=Acme+Org%2B%CE%B2%2Fwidgets+%26+api"',
    );
    expect(html).toContain(
      'href="/runs?repoOwner=Acme+Org%2B%CE%B2&amp;repoName=widgets+%26+api"',
    );
    expect(html).toContain(
      'href="https://github.com/Acme%20Org%2B%CE%B2/widgets%20%26%20api"',
    );
    expect(html).toContain("Acme Org+β/widgets &amp; api");
    expect(html).toContain("4 Automations");
    expect(html).toContain("2 Runs");
    expect(html).toContain("Some Run sources unavailable");
  });

  test("does not expose duplicate product or GitHub-admin discovery nouns", () => {
    const html = renderDashboard({
      owner: "acme",
      repo: "widgets",
      summary: {
        automations: { status: "ready", count: 0 },
        runs: { status: "ready", count: 0 },
      },
    });

    for (const noun of [
      "Project",
      "Agents",
      "Loops",
      "Activity",
      "Pull Requests",
      "Issues",
      "Actions",
      "Tools",
      "Secrets",
    ]) {
      expect(html).not.toContain(noun);
    }
    expect(html).toContain("Repository settings");
  });

  test("shows independent summary failures without converting them to zero", () => {
    const html = renderDashboard({
      owner: "acme",
      repo: "widgets",
      summary: {
        automations: { status: "error" },
        runs: { status: "ready", count: 3 },
      },
    });
    expect(html).toContain("Automation summary unavailable");
    expect(html).toContain("3 Runs");
    expect(html).not.toContain("0 Automations");
  });

  test("labels bounded Run counts and source gaps truthfully", () => {
    const html = renderDashboard({
      owner: "acme",
      repo: "widgets",
      summary: {
        automations: { status: "ready", count: 1 },
        runs: { status: "partial", count: 5, hasMore: true },
      },
    });

    expect(html).toContain("5+ recent Runs");
    expect(html).toContain("Some Run sources unavailable");
    expect(html).not.toContain("5 Runs total");
  });
});
