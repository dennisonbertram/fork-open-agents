import {
  act,
  registerDomTestHooks,
  render,
  userClick,
  waitFor,
  within,
} from "@/tests/dom";
import { beforeEach, describe, expect, mock, test } from "bun:test";

registerDomTestHooks();

let params: Record<string, string | null> = {
  step: "github",
  next: "/sessions",
};
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
    linkSocial.mockImplementation(async () => undefined);
  });

  test("disconnected Connect GitHub uses the sanitized post-link callback", async () => {
    const { GetStartedFlow } = await flowPromise;
    const { container } = render(<GetStartedFlow />);
    await userClick(
      within(container).getByRole("button", { name: "Connect GitHub" }),
    );
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
    await userClick(
      within(first.container).getByRole("button", { name: "Start a Session" }),
    );
    expect(pushes).toEqual(["/sessions"]);
    first.unmount();

    params = { step: "github", next: "/settings/profile" };
    const second = render(<GetStartedFlow />);
    await userClick(
      within(second.container).getByRole("button", { name: "Continue" }),
    );
    expect(pushes).toEqual(["/sessions", "/settings/profile"]);
  });

  test("explicit reconnect still invokes linkSocial", async () => {
    connected = true;
    installed = true;
    params = { step: "github", reconnect: "1", next: "/sessions" };
    const { GetStartedFlow } = await flowPromise;
    const { container } = render(<GetStartedFlow />);
    await userClick(
      within(container).getByRole("button", { name: "Reconnect GitHub" }),
    );
    expect(linkSocial).toHaveBeenCalledTimes(1);
  });

  test("pending disables Connect and rejection renders an alert with retry", async () => {
    let rejectLink: ((reason: Error) => void) | undefined;
    linkSocial.mockImplementation(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectLink = reject;
        }),
    );
    const { GetStartedFlow } = await flowPromise;
    const { container } = render(<GetStartedFlow />);
    const query = within(container);
    const connect = query.getByRole("button", { name: "Connect GitHub" });

    await userClick(connect);
    expect(connect.hasAttribute("disabled")).toBe(true);

    await act(async () => rejectLink?.(new Error("network down")));
    await waitFor(() => expect(query.getByRole("alert")).toBeTruthy());
    expect(query.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(connect.hasAttribute("disabled")).toBe(false);
  });
});
