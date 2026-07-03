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

  // BT-801-050 (#801, finding G7): the agent-builder "Other tools" link and
  // connectHint previously pointed at /settings/background-agents, which is
  // NOT the Composio settings page — a naive user following it lands on the
  // wrong page. Fixed to point at /settings/composio with matching copy.
  test("BT-801-050: includes a link to /settings/composio, not /settings/background-agents", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    expect(html).toContain('href="/settings/composio"');
    expect(html).not.toContain("/settings/background-agents");
  });

  test("BT-801-051: connectHint passed to the picker says 'Settings → Composio', not 'Background agents'", async () => {
    const { ComposioOtherToolsSection } = await modulePromise;

    const html = renderToStaticMarkup(
      <ComposioOtherToolsSection
        selectedSlugs={[]}
        onChange={noop}
        repoOwner="acme"
        repoName="widgets"
      />,
    );

    expect(html).toContain("Settings");
    expect(html).toContain("Composio");
    expect(html).not.toContain("Background agents");
  });
});
