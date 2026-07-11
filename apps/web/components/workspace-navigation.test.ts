import { describe, expect, test } from "bun:test";
import {
  getActiveWorkspaceNavigationItem,
  getWorkspaceNavigationItems,
} from "./workspace-navigation";

const expectedDestinations = [
  { id: "sessions", label: "Sessions", href: "/sessions" },
  { id: "runs", label: "Runs", href: "/runs" },
  { id: "automations", label: "Automations", href: "/automations" },
  { id: "repositories", label: "Repositories", href: "/repos" },
  { id: "settings", label: "Settings", href: "/settings" },
];

describe("workspace navigation contract (#961)", () => {
  test("exposes the exact five destinations in product order", () => {
    expect(
      getWorkspaceNavigationItems().map(({ id, label, href }) => ({
        id,
        label,
        href,
      })),
    ).toEqual(expectedDestinations);
  });

  test("every destination owns one icon and an accessible label", () => {
    for (const item of getWorkspaceNavigationItems()) {
      expect(item.icon).toBeDefined();
      expect(item.ariaLabel).toBe(item.label);
    }
  });

  test("returns an independent array so callers cannot mutate the contract", () => {
    const first = getWorkspaceNavigationItems();
    const second = getWorkspaceNavigationItems();
    first.reverse();
    expect(second.map((item) => item.id)).toEqual(
      expectedDestinations.map((item) => item.id),
    );
  });
});

describe("workspace navigation route matching (#961)", () => {
  const cases: [pathname: string, expectedId: string | null][] = [
    ["/sessions", "sessions"],
    ["/sessions/s_1/chats/c_1", "sessions"],
    ["/runs", "runs"],
    ["/runs/background-agent/r_1", "runs"],
    ["/background-runs/r_1", "runs"],
    ["/loops/l_1/runs/r_1", "runs"],
    ["/loops/l_1/runs", "automations"],
    ["/automations", "automations"],
    ["/automations/background-agent/a_1", "automations"],
    ["/loops", "automations"],
    ["/loops/l_1", "automations"],
    ["/repos/acme/widgets/agents", "automations"],
    ["/repos/acme/widgets/agents/a_1", "automations"],
    ["/repos/acme/widgets/project", "automations"],
    ["/repos/acme/widgets/loops", "automations"],
    ["/settings/background-agents", "automations"],
    ["/settings/background-agents/a_1", "automations"],
    ["/repos", "repositories"],
    ["/repos/acme/widgets", "repositories"],
    ["/repos/acme/widgets/actions", "repositories"],
    ["/repos/acme/widgets/agentsmith", "repositories"],
    ["/repos/acme/widgets/projector", "repositories"],
    ["/repos/acme/widgets/loopsmith", "repositories"],
    ["/settings", "settings"],
    ["/settings/models", "settings"],
    ["/settings/background-agents-old", "settings"],
    ["/", null],
  ];

  for (const [pathname, expectedId] of cases) {
    test(`${pathname} resolves to ${expectedId ?? "no destination"}`, () => {
      expect(getActiveWorkspaceNavigationItem(pathname)?.id ?? null).toBe(
        expectedId,
      );
    });
  }

  test("legacy loop run matching takes precedence over legacy loops", () => {
    expect(getActiveWorkspaceNavigationItem("/loops/l_1/runs/r_1")?.id).toBe(
      "runs",
    );
  });

  test("automation compatibility routes take precedence over repository and settings parents", () => {
    expect(
      getActiveWorkspaceNavigationItem("/repos/acme/widgets/agents")?.id,
    ).toBe("automations");
    expect(
      getActiveWorkspaceNavigationItem("/settings/background-agents")?.id,
    ).toBe("automations");
  });

  test("matches path segments, not ambiguous string prefixes", () => {
    for (const pathname of [
      "/sessionstore",
      "/runner",
      "/loopsmith",
      "/repository",
      "/settings-old",
      "/background-runs-old/r_1",
    ]) {
      expect(getActiveWorkspaceNavigationItem(pathname)).toBeNull();
    }
  });
});
