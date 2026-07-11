import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let userId: string | null = "user-1";
const redirect = mock((path: string) => {
  throw new Error(`redirect:${path}`);
});

mock.module("next/navigation", () => ({ redirect }));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => (userId ? { user: { id: userId } } : {}),
}));

mock.module("./repository-secrets-client", () => ({
  RepositorySecretsClient: ({
    owner,
    repo,
  }: {
    owner: string;
    repo: string;
  }) => <div>SECRETS_CLIENT_STUB:{`${owner}/${repo}`}</div>,
}));

describe("Secrets page", () => {
  beforeEach(() => {
    userId = "user-1";
    redirect.mockClear();
  });

  test("renders the repo-scoped secrets surface with SettingsPageHeader and section copy", async () => {
    const { default: SecretsPage } = await import("./page");

    const html = renderToStaticMarkup(
      await SecretsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    );

    expect(html).toContain("<header");
    expect(html).toContain("Secrets");
    expect(html).toContain(
      "View repository Actions secret names for acme/widgets.",
    );
    expect(html).toContain("Repository secrets");
    expect(html).toContain(
      "GitHub never returns secret values, so we only show names.",
    );
    expect(html).toContain("SECRETS_CLIENT_STUB:acme/widgets");
  });

  test("retains the signed-out auth gate on direct legacy access", async () => {
    userId = null;
    const { default: SecretsPage } = await import("./page");
    await expect(
      SecretsPage({
        params: Promise.resolve({ owner: "acme", repo: "widgets" }),
      }),
    ).rejects.toThrow("redirect:/");
    expect(redirect).toHaveBeenCalledWith("/");
  });

  test("secret value input supports multiline values", async () => {
    const source = await Bun.file(
      "apps/web/app/repos/[owner]/[repo]/secrets/add-secret-dialog.tsx",
    ).text();

    expect(source).toContain(
      'import { Textarea } from "@/components/ui/textarea"',
    );
    expect(source).toContain("<Textarea");
    expect(source).not.toContain('type="password"');
  });
});
