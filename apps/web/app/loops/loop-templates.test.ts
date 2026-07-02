import { describe, expect, test } from "bun:test";
import { validateLoopDefinition } from "@/lib/agent-loops/validation";
import { getLoopTemplate, LOOP_TEMPLATES } from "./loop-templates";

describe("loop templates", () => {
  test("at least the documented starter templates are present", () => {
    const slugs = LOOP_TEMPLATES.map((t) => t.slug);
    expect(slugs).toContain("review-to-issues");
    expect(slugs).toContain("backlog-to-pr");
    expect(slugs).toContain("email-triage");
    expect(slugs).toContain("merge-when-green");
  });

  // #768: "Review PRs and comment" — the most-requested job per walk 1.
  // Must be agent-steps only (no github_check/condition nodes), must not
  // create PRs anywhere in its instructions, and its suggestedTrigger copy
  // must read as a suggestion (not an implemented, wired trigger — trigger
  // CRUD is out of scope here per #762/C1).
  test("#768: 'review-prs-and-comment' template exists, is agent-steps only, and never creates PRs", () => {
    const template = getLoopTemplate("review-prs-and-comment");
    expect(template).toBeDefined();
    if (!template) return;

    expect(template.name.toLowerCase()).toContain("review");
    expect(template.name.toLowerCase()).toContain("comment");

    // Agent steps only: no github_check/condition nodes (those require setup
    // this template's honest scope doesn't need).
    const nonStartEndKinds = template.definition.nodes
      .filter((n) => n.kind !== "start" && n.kind !== "end")
      .map((n) => n.kind);
    expect(nonStartEndKinds.every((kind) => kind === "agent_step")).toBe(true);
    expect(nonStartEndKinds.length).toBeGreaterThan(0);

    // No PR creation anywhere in any step's instructions.
    for (const node of template.definition.nodes) {
      if (node.kind === "agent_step") {
        expect(node.instructions ?? "").not.toMatch(/gh pr create/i);
      }
    }

    // suggestedTrigger must read as a suggestion, not an implemented fact.
    expect(template.suggestedTrigger.toLowerCase()).toMatch(
      /suggest|could|consider|works well/,
    );
  });

  test("#768/#771 review: 'review-prs-and-comment' steps carry the GitHub permissions their gh commands need", () => {
    const template = getLoopTemplate("review-prs-and-comment");
    expect(template).toBeDefined();
    if (!template) {
      return;
    }

    // `gh pr list` needs pull-request read access; the default minted token
    // only carries contents permissions (see lib/agent-loops/token-permissions.ts).
    const listStep = template.definition.nodes.find((n) => n.id === "list");
    expect(listStep?.kind).toBe("agent_step");
    if (listStep?.kind === "agent_step") {
      expect(listStep.permissions?.github?.pullRequests).toBe("read");
    }

    // `gh pr review --comment` creates a PR review — requires pull-request
    // WRITE per GitHub's REST docs; without it the step 403s.
    const reviewStep = template.definition.nodes.find((n) => n.id === "review");
    expect(reviewStep?.kind).toBe("agent_step");
    if (reviewStep?.kind === "agent_step") {
      expect(reviewStep.permissions?.github?.pullRequests).toBe("write");
    }
  });

  test("#768/#771 review: review instruction targets each PR by number (gh pr review without an argument reviews the current branch)", () => {
    const template = getLoopTemplate("review-prs-and-comment");
    const reviewStep = template?.definition.nodes.find(
      (n) => n.id === "review",
    );
    expect(reviewStep?.kind).toBe("agent_step");
    if (reviewStep?.kind === "agent_step") {
      expect(reviewStep.instructions ?? "").toMatch(
        /gh pr review\s+(<|\$\{?)?(pr[_ ]?)?number/i,
      );
    }
  });

  test("every template slug is unique", () => {
    const slugs = LOOP_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  for (const template of LOOP_TEMPLATES) {
    test(`template "${template.slug}" is a valid loop definition`, () => {
      const result = validateLoopDefinition(template.definition);
      if (!result.ok) {
        throw new Error(
          `Template "${template.slug}" is invalid: ${JSON.stringify(result.errors, null, 2)}`,
        );
      }
      expect(result.ok).toBe(true);
    });

    test(`template "${template.slug}" has name, description, and trigger copy`, () => {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.suggestedTrigger.length).toBeGreaterThan(0);
    });
  }

  test("getLoopTemplate resolves a known slug and returns undefined otherwise", () => {
    expect(getLoopTemplate("review-to-issues")?.name).toBe("Review to issues");
    expect(getLoopTemplate("does-not-exist")).toBeUndefined();
  });
});
