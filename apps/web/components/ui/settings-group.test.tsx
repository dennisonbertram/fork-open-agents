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
    // Validate no stray description paragraph appears in the header slot
    // (Use indexOf instead of regex s-flag for ES2015 compat)
    const headerStart = html.indexOf('data-slot="settings-group-header"');
    const headerEnd = html.indexOf('data-slot="settings-group-rows"');
    if (headerStart !== -1 && headerEnd !== -1) {
      const headerRegion = html.slice(headerStart, headerEnd);
      expect(headerRegion).not.toContain("<p");
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
    // Verify rows div contains the child (no s-flag for ES2015 compat)
    const rowsStart = html.indexOf('data-slot="settings-group-rows"');
    expect(rowsStart).toBeGreaterThan(-1);
    const rowsRegion = html.slice(rowsStart);
    expect(rowsRegion).toContain("ROW_CONTENT");
  });
});

describe("Finding 1 — A11y: aria-describedby association", () => {
  test("BT-A11Y-001: description <p> gets an id when description prop is provided", () => {
    // The description <p> must have an id so aria-describedby can reference it.
    const html = renderToStaticMarkup(
      <SettingRow label="Theme" description="Saved in this browser only.">
        <button type="button" id="ctrl">Save</button>
      </SettingRow>,
    );
    // The description paragraph must have an id attribute
    const pMatch = html.match(/<p[^>]*id="([^"]+)"[^>]*>/);
    expect(pMatch).not.toBeNull();
  });

  test("BT-A11Y-002: single-child control gets aria-describedby matching description id", () => {
    // The sole child element must receive aria-describedby equal to the description <p> id.
    const html = renderToStaticMarkup(
      <SettingRow label="Theme" description="Saved in this browser only.">
        <button type="button" id="ctrl">Save</button>
      </SettingRow>,
    );
    // Extract the description paragraph id
    const pMatch = html.match(/<p[^>]*id="([^"]+)"[^>]*>/);
    expect(pMatch).not.toBeNull();
    const descId = pMatch![1];
    // The control must carry a matching aria-describedby
    expect(html).toContain(`aria-describedby="${descId}"`);
  });

  test("BT-A11Y-003: existing aria-describedby on child is preserved (merged) not dropped", () => {
    // If the child already has aria-describedby="existing-id", it must remain in the output.
    const html = renderToStaticMarkup(
      <SettingRow label="Theme" description="Saved in this browser only.">
        <button type="button" id="ctrl" aria-describedby="existing-id">Save</button>
      </SettingRow>,
    );
    expect(html).toContain("existing-id");
    // The description id should also be present (merged, not replaced)
    const pMatch = html.match(/<p[^>]*id="([^"]+)"[^>]*>/);
    expect(pMatch).not.toBeNull();
    const descId = pMatch![1];
    expect(html).toContain(descId);
  });

  test("BT-A11Y-004: no crash and description still rendered when children is not a single element", () => {
    // If children is a fragment or multiple elements, we must not crash; description renders normally.
    const html = renderToStaticMarkup(
      <SettingRow label="Theme" description="Saved in this browser only.">
        <button type="button">A</button>
        <button type="button">B</button>
      </SettingRow>,
    );
    expect(html).toContain("Saved in this browser only.");
  });
});

describe("Finding 2 — Width + responsive: controlClassName prop", () => {
  test("BT-CTRL-001: controlClassName is applied to the control wrapper div class attribute", () => {
    // The control slot div must carry the className passed via controlClassName.
    // We verify this by checking the data-slot="setting-row-control" div's class attribute.
    const html = renderToStaticMarkup(
      <SettingRow label="Theme" controlClassName="w-full sm:max-w-xs">
        <button type="button">Save</button>
      </SettingRow>,
    );
    // Extract the setting-row-control div's class attribute
    const controlMatch = html.match(
      /data-slot="setting-row-control"[^>]*class="([^"]+)"/,
    );
    expect(controlMatch).not.toBeNull();
    expect(controlMatch![1]).toContain("w-full");
    expect(controlMatch![1]).toContain("sm:max-w-xs");
  });

  test("BT-CTRL-002: SettingRow root uses responsive flex layout (flex-col + sm:flex-row)", () => {
    // The row must switch from column-stacked on mobile to side-by-side on sm+.
    const html = renderToStaticMarkup(
      <SettingRow label="Theme">
        <button type="button">Save</button>
      </SettingRow>,
    );
    // Must contain the responsive flex classes
    expect(html).toContain("flex-col");
    expect(html).toContain("sm:flex-row");
  });

  test("BT-CTRL-003: control wrapper class attribute contains controlClassName classes (not a stray DOM attr)", () => {
    // This confirms controlClassName is applied as className (not a raw DOM attribute like controlclassname).
    const html = renderToStaticMarkup(
      <SettingRow label="Theme" controlClassName="SENTINEL_CLASS_XYZ">
        <button type="button">Save</button>
      </SettingRow>,
    );
    // SENTINEL_CLASS_XYZ must appear inside the class attribute of the control wrapper
    const controlMatch = html.match(
      /data-slot="setting-row-control"[^>]*class="([^"]+)"/,
    );
    expect(controlMatch).not.toBeNull();
    expect(controlMatch![1]).toContain("SENTINEL_CLASS_XYZ");
    // Must NOT appear as a raw DOM attribute name
    expect(html).not.toContain('controlclassname=');
  });
});

// Finding 3 — Skeleton tests live in apps/web/app/settings/preferences-section-skeleton.test.tsx
