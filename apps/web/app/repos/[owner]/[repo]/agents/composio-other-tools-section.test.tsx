/**
 * Behavior tests for ComposioOtherToolsSection.
 * Mocks ComposioToolkitPicker (has SWR/DOM dependencies) and asserts the
 * wrapper passes the correct props and renders the connect link.
 */
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// Mock the picker to avoid SWR/window dependencies
mock.module("@/app/settings/composio-toolkit-picker", () => ({
  ComposioToolkitPicker: ({
    selectedSlugs,
    disabled,
    source,
    repoOwner,
    repoName,
  }: {
    selectedSlugs: string[];
    disabled: boolean;
    source: string;
    repoOwner: string | null | undefined;
    repoName: string | null | undefined;
  }) => (
    <div
      data-testid="composio-toolkit-picker"
      data-slugs={selectedSlugs.join(",")}
      data-disabled={String(disabled)}
      data-source={source}
      data-repo-owner={repoOwner ?? ""}
      data-repo-name={repoName ?? ""}
    />
  ),
}));

const modulePromise = import("./composio-other-tools-section");

describe("ComposioOtherToolsSection", () => {
  const noop = () => {};

  test("renders 'Other tools' heading", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    expect(html).toContain("Other tools");
  });

  test("renders the ComposioToolkitPicker mock", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    expect(html).toContain("composio-toolkit-picker");
  });

  test("passes source='connected' to the picker", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    expect(html).toContain('data-source="connected"');
  });

  test("passes repoOwner and repoName to the picker", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    expect(html).toContain('data-repo-owner="acme"');
    expect(html).toContain('data-repo-name="widgets"');
  });

  test("passes selectedSlugs to the picker", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={["gmail", "slack"]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    expect(html).toContain('data-slugs="gmail,slack"');
  });

  test("passes disabled=true to picker when disabled prop is set", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
        disabled={true}
      />,
    );

    expect(html).toContain('data-disabled="true"');
  });

  test("includes a link to /settings/background-agents", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    expect(html).toContain("/settings/background-agents");
  });

  test("distinguishes the opt-in Composio GitHub toolkit from the built-in scoped GitHub capability", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    // Distinguishing copy must call out: (1) the Composio "github" toolkit is
    // live/broader/account-wide, (2) it is not scoped to just this repo, and
    // (3) it runs mid-turn during unattended, auto-approved runs — as opposed
    // to the built-in scoped GitHub capability from the Standard toolpack
    // section, which only opens a pull request after the run.
    expect(html).toContain("broader GitHub access");
    expect(html).toContain("not scoped to this repo");
    expect(html).toContain("scoped to this repository");
  });

  test("distinguishing copy warns the opt-in GitHub toolkit runs mid-turn during unattended runs", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    expect(html).toContain("unattended");
    expect(html).toContain("auto-approved");
  });
});
