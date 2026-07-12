import { registerDomTestHooks, render, within } from "@/tests/dom";
import { beforeEach, describe, expect, mock, test } from "bun:test";

registerDomTestHooks();

let params: Record<string, string | null> = { step: "github", next: "/sessions" };
let connected = false;
let installed = false;
const pushes: string[] = [];
const linkSocial = mock(async (_input: unknown) => undefined);

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (path: string) => pushes.push(path) }),
  useSearchParams: () => ({ get: (key: string) => params[key] ?? null }),
}));
mock.module("@/hooks/use-session", () => ({
  useSession: () => ({
    session: { user: { id: "user-1", name: "Test user" } },
    loading: false,
    hasGitHubAccount: connected,
    hasGitHubInstallations: installed,
  }),
}));
mock.module("@/lib/auth/client", () => ({ authClient: { linkSocial } }));

const flowPromise = import("./get-started-flow");

describe("GetStartedFlow interaction journey (#967)", () => {
  beforeEach(() => {
    params = { step: "github", next: "/sessions" };
    connected = false;
    installed = false;
    pushes.length = 0;
    linkSocial.mockClear();
  });

  test("disconnected Connect GitHub uses the sanitized post-link callback", async () => {
    const { GetStartedFlow } = await flowPromise;
    const { container } = render(<GetStartedFlow />);
    within(container).getByRole("button", { name: "Connect GitHub" }).click();
    await Promise.resolve();
    expect(linkSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/api/github/post-link?next=%2Fsessions",
    });
  });

  test("connected Session and safe saved destinations push the exact path", async () => {
    connected = true;
    installed = true;
    const { GetStartedFlow } = await flowPromise;
    const first = render(<GetStartedFlow />);
    within(first.container).getByRole("button", { name: "Start a Session" }).click();
    expect(pushes).toEqual(["/sessions"]);
    first.unmount();

    params = { step: "github", next: "/settings/profile" };
    const second = render(<GetStartedFlow />);
    within(second.container).getByRole("button", { name: "Continue" }).click();
    expect(pushes).toEqual(["/sessions", "/settings/profile"]);
  });

  test("explicit reconnect still invokes linkSocial", async () => {
    connected = true;
    installed = true;
    params = { step: "github", reconnect: "1", next: "/sessions" };
    const { GetStartedFlow } = await flowPromise;
    const { container } = render(<GetStartedFlow />);
    within(container).getByRole("button", { name: "Reconnect GitHub" }).click();
    await Promise.resolve();
    expect(linkSocial).toHaveBeenCalledTimes(1);
  });
});
