#!/usr/bin/env bash
# setup.sh — install the virtual-desktop stack into a Vercel Sandbox.
#
# Target OS: Amazon Linux 2023 (Firecracker microVM). Package manager: dnf.
# Runs as a user with sudo (mirrors the documented `vercel-sandbox` user).
#
# IMPORTANT findings about the AL2023 default repos (verified empirically in
# this POC's eval, see README "Blind Spots Eliminated"):
#   * x11vnc, fluxbox, openbox, twm, icewm, matchbox, novnc, python3-websockify
#     are NOT packaged.
#   * tigervnc-server IS packaged and ships `x0vncserver`, which exports an
#     existing X display over RFB — the drop-in replacement for x11vnc.
#   * websockify + the noVNC client are installed via pip + a pinned GitHub
#     tarball respectively.
#
# Components installed:
#   xorg-x11-server-Xvfb  -> headless X framebuffer server
#   tigervnc-server       -> provides x0vncserver (RFB export of Xvfb)
#   a window manager      -> first available of: metacity, mwm (motif),
#                            mutter, marco, twm; tolerated-absent otherwise
#   websockify (pip)      -> WebSocket<->TCP bridge for noVNC
#   noVNC (GitHub tarball)-> browser client
#   xterm                 -> a GUI app to prove the desktop renders
#   xorg-x11-utils        -> xdpyinfo/xprop, for verification
#   ImageMagick           -> `import`, to screenshot the framebuffer
set -euo pipefail

SUDO=""
if command -v sudo >/dev/null 2>&1 && [ "$(id -u)" != "0" ]; then
  SUDO="sudo"
fi

NOVNC_VERSION="${NOVNC_VERSION:-1.5.0}"
NOVNC_INSTALL_DIR="${NOVNC_WEB_ROOT:-/usr/share/novnc}"

# Note: we intentionally do NOT run a separate `dnf makecache`; `dnf install`
# refreshes metadata itself. Skipping it avoids a redundant ~65MB metadata
# download under sandbox cold-start.

# Core packages reliably present in the AL2023 repos.
echo "[setup] installing X server, VNC server, and tools via dnf"
$SUDO dnf -y install \
  xorg-x11-server-Xvfb \
  tigervnc-server \
  xterm \
  xorg-x11-utils \
  ImageMagick \
  procps-ng \
  tar gzip \
  python3 python3-pip

# Window manager: AL2023 packages no lightweight WM under the usual names, so
# try a list of candidates and tolerate absence. A WM is preferred (gives apps
# decorations/focus) but the desktop still streams without one.
WM_BIN=""
for pkg_bin in "metacity:metacity" "motif:mwm" "mutter:mutter" "marco:marco" \
  "xorg-x11-twm:twm" "twm:twm" "openbox:openbox" "fluxbox:fluxbox" "icewm:icewm"; do
  pkg="${pkg_bin%%:*}"
  bin="${pkg_bin##*:}"
  if $SUDO dnf -y install "$pkg" >/dev/null 2>&1; then
    if command -v "$bin" >/dev/null 2>&1; then
      WM_BIN="$(command -v "$bin")"
      echo "[setup] window manager installed: $pkg ($WM_BIN)"
      break
    fi
  fi
done
[ -n "$WM_BIN" ] || echo "[setup] WARNING: no packaged window manager available; desktop will run WM-less"

# websockify: not packaged on AL2023 -> pip.
if ! command -v websockify >/dev/null 2>&1; then
  echo "[setup] installing websockify via pip"
  $SUDO python3 -m pip install --quiet websockify
fi

# noVNC client: not packaged on AL2023 -> pinned GitHub tarball.
if [ ! -f "$NOVNC_INSTALL_DIR/vnc.html" ] && [ ! -f "$NOVNC_INSTALL_DIR/vnc_lite.html" ]; then
  echo "[setup] fetching noVNC v$NOVNC_VERSION from GitHub"
  tmp="$(mktemp -d)"
  url="https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.tar.gz"
  curl -fsSL "$url" -o "$tmp/novnc.tar.gz"
  $SUDO mkdir -p "$NOVNC_INSTALL_DIR"
  $SUDO tar -xzf "$tmp/novnc.tar.gz" -C "$NOVNC_INSTALL_DIR" --strip-components=1
  if [ -f "$NOVNC_INSTALL_DIR/vnc.html" ]; then
    $SUDO ln -sf "$NOVNC_INSTALL_DIR/vnc.html" "$NOVNC_INSTALL_DIR/index.html" || true
  fi
  rm -rf "$tmp"
fi

# Record the chosen WM so start-desktop.sh can launch it without re-probing.
$SUDO mkdir -p /etc/open-agents 2>/dev/null || mkdir -p "$HOME/.open-agents" 2>/dev/null || true
if [ -n "$WM_BIN" ]; then
  echo "$WM_BIN" | $SUDO tee /etc/open-agents/desktop-wm >/dev/null 2>&1 \
    || echo "$WM_BIN" > "$HOME/.open-agents/desktop-wm"
fi

echo "[setup] versions:"
Xvfb -help 2>&1 | head -n1 || true
(command -v x0vncserver && x0vncserver --version 2>&1 | head -n1) || echo "x0vncserver: (version flag n/a)"
(command -v websockify && echo "websockify OK") || \
  (python3 -c 'import websockify; print("websockify module OK")')
echo "[setup] window manager: ${WM_BIN:-NONE}"
echo "[setup] noVNC root: $NOVNC_INSTALL_DIR"
ls "$NOVNC_INSTALL_DIR"/vnc*.html 2>/dev/null || echo "[setup] WARNING: noVNC client html not found"

echo "[setup] virtual-desktop stack installed"
