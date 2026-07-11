import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("./agents-loader", () => ({
  AgentsLoader: () => <div>CHAT_ROLES_LOADER</div>,
}));

const pageModulePromise = import("./page");

describe("Chat roles Settings page (#964)", () => {
  test("uses interactive role vocabulary and links unattended work to Automations", async () => {
    const { default: AgentsPage } = await pageModulePromise;
    const html = renderToStaticMarkup(<AgentsPage />);

    expect(html).toContain("Chat roles");
    expect(html).toContain("inside interactive Sessions");
    expect(html).toContain('href="/automations"');
    expect(html).toContain("See Automations");
    expect(html).not.toContain('href="/settings/background-agents"');
    expect(html).not.toContain("See Background agents");
  });
});
