import { describe, expect, mock, test } from "bun:test";
import { registerDomTestHooks, render, userClick, within } from "@/tests/dom";

registerDomTestHooks();

const openNewSessionDialog = mock(
  (_repository?: { owner: string; repo: string }) => undefined,
);

mock.module("@/app/sessions/sessions-shell-context", () => ({
  useSessionsShell: () => ({ openNewSessionDialog }),
}));

const actionModulePromise = import("./repository-new-session-action");

describe("RepositoryNewSessionAction", () => {
  test("opens the existing shell dialog with this repository preselected", async () => {
    const { RepositoryNewSessionAction } = await actionModulePromise;
    const { container } = render(
      <RepositoryNewSessionAction owner="Acme Org" repo="widgets/api" />,
    );

    await userClick(
      within(container).getByRole("button", { name: "New Session" }),
    );

    expect(openNewSessionDialog).toHaveBeenCalledWith({
      owner: "Acme Org",
      repo: "widgets/api",
    });
  });
});
