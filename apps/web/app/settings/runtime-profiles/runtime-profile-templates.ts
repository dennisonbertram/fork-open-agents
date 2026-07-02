/**
 * Starter templates for the profile create form.
 *
 * A naive user's goal ("make my sessions use Python 3.12") requires
 * hand-authoring raw shell today. These templates let a user pick a
 * pre-built, editable form state instead — pure data, no runtime coupling.
 * Picking a template produces an ordinary saved profile through the same
 * create path as hand-authored profiles (spine rule: no special-cased
 * execution behavior for template-derived profiles).
 *
 * Each template's verification commands must actually prove what its setup
 * commands install — do not add a tool to expectedTools/setup without a
 * matching verification command.
 */

import type { RuntimeProfileFormState } from "./runtime-profile-payload";

export type RuntimeProfileTemplate = {
  id: string;
  displayName: string;
  description: string;
  form: RuntimeProfileFormState;
};

const PYTHON_3_12_TEMPLATE: RuntimeProfileTemplate = {
  id: "python-3-12",
  displayName: "Python 3.12",
  description:
    "Installs Python 3.12 with uv (falling back to pyenv) and verifies python3.12 --version runs.",
  form: {
    displayName: "Python 3.12",
    description:
      "Installs Python 3.12 with uv and verifies python3.12 --version runs.",
    expectedTools: "python3.12, uv",
    optionalTools: "",
    defaultPorts: "",
    setupCommands: [
      {
        id: "install-python-3-12",
        label: "Install Python 3.12",
        description:
          "Install uv (a fast Python toolchain manager) and use it to install Python 3.12. Falls back to pyenv if uv is unavailable.",
        command: [
          "set -e",
          "if ! command -v uv >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh; fi",
          'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"',
          "if command -v uv >/dev/null 2>&1; then",
          "  uv python install 3.12",
          "else",
          "  curl -fsSL https://pyenv.run | bash",
          '  export PATH="$HOME/.pyenv/bin:$PATH"',
          '  eval "$(pyenv init -)"',
          "  pyenv install -s 3.12",
          "  pyenv global 3.12",
          "fi",
        ].join("\n"),
        required: true,
      },
    ],
    verificationCommands: [
      {
        id: "verify-python-3-12",
        label: "Verify Python 3.12",
        description:
          "Confirm python3.12 is on PATH and reports the expected version.",
        command: [
          'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.pyenv/bin:$PATH"',
          "python3.12 --version",
        ].join("\n"),
        required: true,
      },
    ],
  },
};

const NODE_20_BUN_WEB_APP_TEMPLATE: RuntimeProfileTemplate = {
  id: "node-20-bun-web-app",
  displayName: "Node 20 / Bun web app",
  description:
    "Installs Node 20 and Bun, then verifies both bun --version and node --version run.",
  form: {
    displayName: "Node 20 / Bun web app",
    description:
      "Installs Node 20 and Bun for running a JS/TS web app, and verifies both are on PATH.",
    expectedTools: "node, bun",
    optionalTools: "npm",
    defaultPorts: "3000",
    setupCommands: [
      {
        id: "install-node-20",
        label: "Install Node 20",
        description: "Install Node 20 via nvm.",
        command: [
          "set -e",
          'if [ ! -s "$HOME/.nvm/nvm.sh" ]; then curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash; fi',
          '\\. "$HOME/.nvm/nvm.sh"',
          "nvm install 20",
          "nvm alias default 20",
        ].join("\n"),
        required: true,
      },
      {
        id: "install-bun",
        label: "Install Bun",
        description: "Install the Bun runtime.",
        command: [
          "set -e",
          "if ! command -v bun >/dev/null 2>&1; then curl -fsSL https://bun.com/install | bash; fi",
        ].join("\n"),
        required: true,
      },
    ],
    verificationCommands: [
      {
        id: "verify-node-20",
        label: "Verify Node 20",
        description: "Confirm node reports a version.",
        command: [
          '\\. "$HOME/.nvm/nvm.sh" 2>/dev/null || true',
          "node --version",
        ].join("\n"),
        required: true,
      },
      {
        id: "verify-bun",
        label: "Verify Bun",
        description: "Confirm bun reports a version.",
        command: ['export PATH="$HOME/.bun/bin:$PATH"', "bun --version"].join(
          "\n",
        ),
        required: true,
      },
    ],
  },
};

const BLANK_TEMPLATE: RuntimeProfileTemplate = {
  id: "blank",
  displayName: "Blank",
  description: "Start from an empty profile and write your own commands.",
  form: {
    displayName: "",
    description: "",
    expectedTools: "",
    optionalTools: "",
    defaultPorts: "",
    setupCommands: [
      {
        id: "setup-1",
        label: "Setup",
        description: "Prepare the environment",
        command: "",
        required: true,
      },
    ],
    verificationCommands: [
      {
        id: "verify-1",
        label: "Verify",
        description: "Confirm the environment is ready",
        command: "",
        required: true,
      },
    ],
  },
};

export const RUNTIME_PROFILE_TEMPLATES: RuntimeProfileTemplate[] = [
  PYTHON_3_12_TEMPLATE,
  NODE_20_BUN_WEB_APP_TEMPLATE,
  BLANK_TEMPLATE,
];

export function getRuntimeProfileTemplate(
  id: string,
): RuntimeProfileTemplate | undefined {
  return RUNTIME_PROFILE_TEMPLATES.find((template) => template.id === id);
}
