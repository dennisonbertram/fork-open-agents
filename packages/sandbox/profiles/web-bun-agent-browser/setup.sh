#!/usr/bin/env bash
set -euo pipefail

# This profile installs Bun as the first concrete application install we need
# for Open Agents web-app repositories. Bun is profile-specific, not a global
# managed-runtime assumption.

profile_bin_dir="$HOME/.open-agents/bin"
export PATH="$profile_bin_dir:$HOME/.bun/bin:$HOME/.bun/install/global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
mkdir -p "$profile_bin_dir"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.com/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

bun_path="$(command -v bun)"
mkdir -p /usr/local/bin 2>/dev/null || true
ln -sf "$bun_path" /usr/local/bin/bun 2>/dev/null || true
ln -sf "$bun_path" "$profile_bin_dir/bun"

echo "bun: $(command -v bun)"
bun --version

if ! command -v agent-browser >/dev/null 2>&1; then
  if command -v bun >/dev/null 2>&1; then
    bun install -g agent-browser
  elif command -v npm >/dev/null 2>&1; then
    npm install -g agent-browser
  else
    echo "No package manager is available to install agent-browser." >&2
    exit 1
  fi
fi

echo "agent-browser: $(command -v agent-browser)"
agent_browser_path="$(command -v agent-browser)"
ln -sf "$agent_browser_path" "$profile_bin_dir/agent-browser"

if command -v node >/dev/null 2>&1; then
  echo "node: $(node --version)"
else
  echo "node: unavailable (not required by the managed runtime platform; profiles must declare their own requirements)"
fi

if command -v npm >/dev/null 2>&1; then
  echo "npm: $(npm --version)"
else
  echo "npm: unavailable (not required by the managed runtime platform; profiles must declare their own requirements)"
fi
