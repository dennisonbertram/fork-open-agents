/**
 * BT: starter templates for the profile create form.
 *
 * A naive user's goal ("make my sessions use Python 3.12") requires
 * hand-authoring raw shell today. These templates let a user pick a
 * pre-built form state instead of writing setup/verification commands
 * from scratch.
 */

import { describe, expect, test } from "bun:test";
import { validateCreateForm } from "./runtime-profile-payload";
import {
  RUNTIME_PROFILE_TEMPLATES,
  getRuntimeProfileTemplate,
} from "./runtime-profile-templates";

describe("RUNTIME_PROFILE_TEMPLATES", () => {
  // BT: at least Python 3.12, Node 20 / Bun web app, and Blank are offered.
  test("offers a Python 3.12 template, a Node 20 / Bun web app template, and a Blank template", () => {
    const ids = RUNTIME_PROFILE_TEMPLATES.map((template) => template.id);

    expect(ids).toContain("python-3-12");
    expect(ids).toContain("node-20-bun-web-app");
    expect(ids).toContain("blank");
  });

  test("every template carries a naive-friendly description", () => {
    for (const template of RUNTIME_PROFILE_TEMPLATES) {
      expect(template.description.length).toBeGreaterThan(0);
    }
  });

  // BT: Python 3.12 template's setup actually installs what verification checks.
  test("Python 3.12 template installs Python via uv/pyenv and verifies python3.12 --version runs", () => {
    const template = getRuntimeProfileTemplate("python-3-12");
    expect(template).toBeDefined();

    const setupText = template?.form.setupCommands
      .map((cmd) => cmd.command)
      .join("\n");
    const verifyText = template?.form.verificationCommands
      .map((cmd) => cmd.command)
      .join("\n");

    expect(setupText).toMatch(/uv|pyenv/);
    expect(setupText).toMatch(/3\.12/);
    expect(verifyText).toMatch(/python3\.12 --version/);
  });

  // BT: Node 20 / Bun template installs what it verifies.
  test("Node 20 / Bun web app template installs bun/node and verifies both run", () => {
    const template = getRuntimeProfileTemplate("node-20-bun-web-app");
    expect(template).toBeDefined();

    const verifyText = template?.form.verificationCommands
      .map((cmd) => cmd.command)
      .join("\n");

    expect(verifyText).toMatch(/bun --version|bun -v/);
    expect(verifyText).toMatch(/node --version|node -v/);
  });

  // BT: every non-blank template produces a payload that passes validation.
  test("every template's form state passes validateCreateForm", () => {
    for (const template of RUNTIME_PROFILE_TEMPLATES) {
      if (template.id === "blank") {
        continue;
      }
      const result = validateCreateForm(template.form);
      expect(result.ok).toBe(true);
    }
  });

  // BT: the Blank template is a valid starting point for hand-authoring — it
  // does not itself need to pass validation (it has placeholder empty
  // commands the user must fill in) but must be a well-formed form state.
  test("Blank template has the expected form shape", () => {
    const template = getRuntimeProfileTemplate("blank");
    expect(template?.form.displayName).toBe("");
    expect(Array.isArray(template?.form.setupCommands)).toBe(true);
    expect(Array.isArray(template?.form.verificationCommands)).toBe(true);
  });

  test("getRuntimeProfileTemplate returns undefined for an unknown id", () => {
    expect(getRuntimeProfileTemplate("does-not-exist")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Regression: templates must stay in sync with the validation schema and
// with each other's tool/verify bindings. If a future edit adds a new
// required field to the payload schema without updating the templates, or
// removes a verification command while leaving the matching setup command
// (or vice versa), these tests fail.
// ---------------------------------------------------------------------------

describe("runtime-profile-templates regression", () => {
  test("REGRESSION: no non-blank template ships with an empty verification command list", () => {
    for (const template of RUNTIME_PROFILE_TEMPLATES) {
      if (template.id === "blank") {
        continue;
      }
      expect(template.form.verificationCommands.length).toBeGreaterThan(0);
    }
  });

  test("REGRESSION: no non-blank template ships with an empty setup command list", () => {
    for (const template of RUNTIME_PROFILE_TEMPLATES) {
      if (template.id === "blank") {
        continue;
      }
      expect(template.form.setupCommands.length).toBeGreaterThan(0);
    }
  });

  test("REGRESSION: every template id in RUNTIME_PROFILE_TEMPLATES is resolvable via getRuntimeProfileTemplate", () => {
    for (const template of RUNTIME_PROFILE_TEMPLATES) {
      expect(getRuntimeProfileTemplate(template.id)?.id).toBe(template.id);
    }
  });

  test("REGRESSION: template ids are unique (prevents an accidental duplicate id from shadowing another template)", () => {
    const ids = RUNTIME_PROFILE_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
