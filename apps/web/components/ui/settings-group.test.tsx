import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsGroup, SettingRow } from "./settings-group";

describe("SettingsGroup", () => {
  test("BT-001: renders title text", () => {
    const html = renderToStaticMarkup(
      <SettingsGroup title="Appearance" />,
    );
    expect(html).toContain("Appearance");
  });

  test("BT-002: renders description text when provided", () => {
    const html = renderToStaticMarkup(
      <SettingsGroup
        title="Appearance"
        description="How Open Agents looks in this browser."
      />,
    );
    expect(html).toContain("How Open Agents looks in this browser.");
  });

  test("BT-003: omits description paragraph when not provided", () => {
    const html = renderToStaticMarkup(
      <SettingsGroup title="Appearance" />,
    );
    // The header should not contain a <p> tag when description is absent
    expect(html).not.toContain("How Open Agents looks");
    // Validate no stray description paragraph appears
    const headerMatch = html.match(/data-slot="settings-group-header"[^>]*>(.*)/s);
    if (headerMatch) {
      // description <p> should not be present in the header area
      expect(headerMatch[1]).not.toContain("<p");
    }
  });

  test("BT-004: rows region carries the hairline divider class (divide-y)", () => {
    const html = renderToStaticMarkup(
      <SettingsGroup title="Appearance">
        <div>Row 1</div>
        <div>Row 2</div>
      </SettingsGroup>,
    );
    expect(html).toContain("divide-y");
  });

  test("BT-005: tone=danger emits border-destructive on the group container", () => {
    const html = renderToStaticMarkup(
      <SettingsGroup title="Danger zone" tone="danger" />,
    );
    expect(html).toContain("border-destructive");
  });

  test("BT-006: tone=danger emits text-destructive on the title", () => {
    const html = renderToStaticMarkup(
      <SettingsGroup title="Danger zone" tone="danger" />,
    );
    expect(html).toContain("text-destructive");
  });
});

describe("SettingRow", () => {
  test("BT-007: renders label text", () => {
    const html = renderToStaticMarkup(
      <SettingRow label="Theme" />,
    );
    expect(html).toContain("Theme");
  });

  test("BT-008: renders optional description text when provided", () => {
    const html = renderToStaticMarkup(
      <SettingRow
        label="Theme"
        description="Saved in this browser only."
      />,
    );
    expect(html).toContain("Saved in this browser only.");
  });

  test("BT-009: renders control child in the right-aligned slot", () => {
    const html = renderToStaticMarkup(
      <SettingRow label="Theme">
        <button type="button">Save</button>
      </SettingRow>,
    );
    expect(html).toContain("Save");
    expect(html).toContain('data-slot="setting-row-control"');
  });

  test("BT-010: htmlFor is forwarded to the label element as for attribute", () => {
    const html = renderToStaticMarkup(
      <SettingRow label="Theme" htmlFor="appearance" />,
    );
    expect(html).toContain('for="appearance"');
  });

  test("BT-011: control slot absent when no children provided", () => {
    const html = renderToStaticMarkup(
      <SettingRow label="Theme" />,
    );
    expect(html).not.toContain('data-slot="setting-row-control"');
  });
});
