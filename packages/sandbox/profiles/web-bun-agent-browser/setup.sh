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

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required before installing agent-browser for this profile." >&2
  exit 1
fi

rm -f "$profile_bin_dir/agent-browser" "$HOME/.bun/bin/agent-browser"
rm -rf "$HOME/.bun/install/global/node_modules/agent-browser"
bun install -g agent-browser

echo "agent-browser: $(command -v agent-browser)"
agent_browser_bin_dir="$HOME/.bun/install/global/node_modules/agent-browser/bin"
platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) agent_browser_arch="x64" ;;
  arm64 | aarch64) agent_browser_arch="arm64" ;;
  *)
    echo "Unsupported agent-browser architecture: $arch" >&2
    exit 1
    ;;
esac
agent_browser_path="$agent_browser_bin_dir/agent-browser-$platform-$agent_browser_arch"
if [ ! -x "$agent_browser_path" ]; then
  echo "agent-browser native binary was not found after install: $agent_browser_path" >&2
  exit 1
fi

rm -f "$profile_bin_dir/agent-browser"
printf '#!/usr/bin/env sh\nexec %s "$@"\n' "$agent_browser_path" > "$profile_bin_dir/agent-browser"
chmod +x "$profile_bin_dir/agent-browser"
agent-browser --help >/dev/null
agent-browser install --with-deps

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
