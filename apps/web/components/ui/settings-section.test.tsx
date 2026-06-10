import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPageHeader, SettingsSection } from "./settings-section";

describe("SettingsPageHeader", () => {
  test("renders title and plain-language description", () => {
    const html = renderToStaticMarkup(
      <SettingsPageHeader
        title="Preferences"
        description="Tune how Open Agents behaves for you."
      />,
    );
    expect(html).toContain("Preferences");
    expect(html).toContain("Tune how Open Agents behaves for you.");
  });

  test("omits description paragraph when not provided", () => {
    const html = renderToStaticMarkup(<SettingsPageHeader title="Models" />);
    expect(html).toContain("Models");
    expect(html).not.toContain("<p");
  });
});

describe("SettingsSection", () => {
  test("renders a noun title and an effect description", () => {
    const html = renderToStaticMarkup(
      <SettingsSection
        title="Default models"
        description="The models new chats use unless you pick something else."
      />,
    );
    expect(html).toContain("Default models");
    expect(html).toContain(
      "The models new chats use unless you pick something else.",
    );
  });

  test("renders a learn-more link only when href is provided", () => {
    const withLink = renderToStaticMarkup(
      <SettingsSection
        title="Personal API keys"
        description="Bring your own provider key."
        learnMore={{ href: "https://example.com/docs", label: "Learn more" }}
      />,
    );
    expect(withLink).toContain('href="https://example.com/docs"');
    expect(withLink).toContain("Learn more");

    const withoutLink = renderToStaticMarkup(
      <SettingsSection
        title="Personal API keys"
        description="Bring your own provider key."
      />,
    );
    expect(withoutLink).not.toContain("Learn more");
  });

  test("keeps advanced children collapsed by default (not in initial markup)", () => {
    const html = renderToStaticMarkup(
      <SettingsSection
        title="Model variants"
        advanced={{ children: <div>SECRET_ADVANCED_BODY</div> }}
      />,
    );
    // The disclosure control is present...
    expect(html).toContain("Advanced");
    // ...but its body is hidden until the user expands it.
    expect(html).not.toContain("SECRET_ADVANCED_BODY");
  });

  test("uses a destructive fence when tone is danger", () => {
    const html = renderToStaticMarkup(
      <SettingsSection title="Danger zone" tone="danger">
        <div>revoke</div>
      </SettingsSection>,
    );
    expect(html).toContain("border-destructive");
  });

  test("renders an action slot when provided", () => {
    const html = renderToStaticMarkup(
      <SettingsSection
        title="GitHub"
        action={<button type="button">Connect</button>}
      >
        <div />
      </SettingsSection>,
    );
    expect(html).toContain("Connect");
  });
});
