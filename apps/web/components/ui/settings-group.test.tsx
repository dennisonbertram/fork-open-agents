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

describe("Regression", () => {
  test("REG-001: SettingsGroup data-slot attributes are present for CSS selectors", () => {
    // If these slots are removed, downstream CSS targeting data-slot will silently break
    const html = renderToStaticMarkup(
      <SettingsGroup title="Models" description="Default model settings.">
        <SettingRow label="Chat model">
          <button type="button">Pick</button>
        </SettingRow>
      </SettingsGroup>,
    );
    expect(html).toContain('data-slot="settings-group"');
    expect(html).toContain('data-slot="settings-group-header"');
    expect(html).toContain('data-slot="settings-group-rows"');
    expect(html).toContain('data-slot="setting-row"');
    expect(html).toContain('data-slot="setting-row-control"');
  });

  test("REG-002: SettingRow without htmlFor uses span not label element", () => {
    // If someone changes the conditional to always emit a <label>, the for= attribute
    // mismatch silently degrades a11y for rows without a paired control id.
    const html = renderToStaticMarkup(
      <SettingRow label="Info only" />,
    );
    // No label element (which would have for= attribute) should be present
    expect(html).not.toContain("<label");
    // But the label text must still appear in a span
    expect(html).toContain("Info only");
  });

  test("REG-003: default tone=default does not emit destructive classes", () => {
    // Catches accidental regression where danger styling leaks into default groups
    const html = renderToStaticMarkup(
      <SettingsGroup title="Normal section" />,
    );
    expect(html).not.toContain("border-destructive/30");
    expect(html).not.toContain("text-destructive");
  });

  test("REG-004: SettingsGroup passes extra className through to root element", () => {
    // Ensures spread props work correctly for customization
    const html = renderToStaticMarkup(
      <SettingsGroup title="Custom" className="my-custom-class" />,
    );
    expect(html).toContain("my-custom-class");
  });

  test("REG-005: SettingsGroup children appear inside the rows div, not the header", () => {
    // Catches structural regressions where children land in the wrong slot
    const html = renderToStaticMarkup(
      <SettingsGroup title="Group">
        <div id="my-row-child">ROW_CONTENT</div>
      </SettingsGroup>,
    );
    // Verify rows div contains the child
    const rowsMatch = html.match(/data-slot="settings-group-rows"[^>]*>([\s\S]*?)<\/div>/);
    expect(rowsMatch).toBeTruthy();
    if (rowsMatch) {
      expect(rowsMatch[1]).toContain("ROW_CONTENT");
    }
  });
});
