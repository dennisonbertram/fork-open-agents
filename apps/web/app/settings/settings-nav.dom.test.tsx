import { registerDomTestHooks, render, within } from "@/tests/dom";

import { describe, expect, test } from "bun:test";
import { SettingsNav } from "./settings-nav";

registerDomTestHooks();

describe("SettingsNav information architecture (#964)", () => {
  test("normal users see three labelled non-empty groups and thirteen links", () => {
    const { container } = render(
      <SettingsNav pathname="/settings/agents" isAdmin={false} />,
    );
    const q = within(container);

    expect(
      q.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Account", "Workspace", "Advanced"]);
    expect(q.getAllByRole("list")).toHaveLength(3);
    expect(q.getAllByRole("link")).toHaveLength(13);
    expect(q.queryByRole("heading", { name: "Admin" })).toBeNull();
  });

  test("admins see Admin fourth and every list is labelled by its heading", () => {
    const { container } = render(
      <SettingsNav pathname="/settings/admin" isAdmin />,
    );
    const q = within(container);
    const headings = q.getAllByRole("heading", { level: 2 });

    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Account",
      "Workspace",
      "Advanced",
      "Admin",
    ]);
    expect(q.getAllByRole("link")).toHaveLength(14);
    for (const list of q.getAllByRole("list")) {
      const labelledBy = list.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();
      expect(container.querySelector(`#${labelledBy}`)).toBeTruthy();
    }
  });

  test("Chat roles owns active state and every link has a visible focus ring", () => {
    const { container } = render(
      <SettingsNav pathname="/settings/agents" isAdmin={false} />,
    );
    const q = within(container);
    const current = q.getByRole("link", { current: "page" });

    expect(current.textContent).toContain("Chat roles");
    expect(current.getAttribute("href")).toBe("/settings/agents");
    for (const link of q.getAllByRole("link")) {
      expect(link.className).toContain("focus-visible:ring-2");
    }
  });

  test("two simultaneously rendered nav instances have unique heading ids", () => {
    const { container } = render(
      <>
        <SettingsNav pathname="/settings/profile" isAdmin={false} />
        <SettingsNav pathname="/settings/profile" isAdmin={false} />
      </>,
    );
    const ids = within(container)
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
