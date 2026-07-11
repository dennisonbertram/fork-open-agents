import { fireEvent, registerDomTestHooks, render, within } from "@/tests/dom";
import { describe, expect, mock, test } from "bun:test";

mock.module("next/link", () => ({
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

import { WorkspaceNavigation } from "./workspace-navigation";

registerDomTestHooks();

const destinationNames = [
  "Sessions",
  "Runs",
  "Automations",
  "Repositories",
  "Settings",
];

describe("WorkspaceNavigation render modes (#961)", () => {
  for (const mode of ["expanded", "collapsed", "mobile"] as const) {
    test(`${mode} renders the same ordered five-destination contract`, () => {
      const { container } = render(
        <WorkspaceNavigation mode={mode} pathname="/automations" />,
      );
      const links = within(container).getAllByRole("link");

      expect(within(container).getAllByRole("navigation")).toHaveLength(1);

      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        "/sessions",
        "/runs",
        "/automations",
        "/repos",
        "/settings",
      ]);
      expect(
        links.map(
          (link) =>
            link.textContent?.trim() || link.getAttribute("aria-label"),
        ),
      ).toEqual(destinationNames);
      for (const link of links) {
        expect(link.className).toContain("focus-visible:ring-2");
      }
    });
  }

  test("marks only the highest-precedence active destination", () => {
    const { container } = render(
      <WorkspaceNavigation
        mode="expanded"
        pathname="/loops/l_1/runs/r_1"
      />,
    );
    const current = within(container).getByRole("link", { current: "page" });

    expect(current.getAttribute("href")).toBe("/runs");
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  test("collapsed links keep accessible names while hiding visible labels", () => {
    const { container } = render(
      <WorkspaceNavigation mode="collapsed" pathname="/sessions" />,
    );
    const q = within(container);

    for (const name of destinationNames) {
      expect(q.getByRole("link", { name })).toBeTruthy();
    }
    expect(container.querySelectorAll("[data-navigation-label]")).toHaveLength(
      0,
    );
    expect(container.querySelectorAll("[data-navigation-tooltip]")).toHaveLength(
      5,
    );
  });

  test("mobile navigation closes its Sheet after a destination is chosen", () => {
    const onNavigate = mock(() => undefined);
    const { container } = render(
      <WorkspaceNavigation
        mode="mobile"
        pathname="/sessions"
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(
      within(container).getByRole("link", { name: "Automations" }),
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
