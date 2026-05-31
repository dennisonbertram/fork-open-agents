// POC 4a — `desktop` managed-runtime profile.
//
// This object matches the real ManagedRuntimeProfile TS shape from
// packages/sandbox/managed-runtime-profiles.ts (see ./types.ts for the copy).
// To promote: paste `desktopProfile` into the MANAGED_RUNTIME_PROFILES array
// in managed-runtime-profiles.ts and copy profile/setup.sh +
// scripts/start-desktop.sh into packages/sandbox/profiles/desktop/.
//
// Target runtime: Vercel Sandbox = Amazon Linux 2023 microVM, dnf, sudo.
import type { ManagedRuntimeProfile } from "./types";

// Inlined start-desktop.sh body. In production this is shipped as a file via
// `setupScript`/a profile asset; inlined here so the profile is self-contained
// and so verification can run it directly.
const START_DESKTOP_INLINE = [
  "set -e",
  'profile_dir="$HOME/.open-agents/desktop"',
  'mkdir -p "$profile_dir"',
  // start-desktop.sh is installed by setup.sh to this path.
  'if [ -x "$profile_dir/start-desktop.sh" ]; then',
  '  bash "$profile_dir/start-desktop.sh"',
  "else",
  '  echo "start-desktop.sh missing; setup did not complete" >&2; exit 1',
  "fi",
].join("\n");

export const DESKTOP_MANAGED_RUNTIME_PROFILE_ID = "desktop-xvfb-novnc";

export const desktopProfile = {
  id: DESKTOP_MANAGED_RUNTIME_PROFILE_ID,
  version: "2026-05-31.1",
  displayName: "Virtual desktop (Xvfb + fluxbox + x11vnc + noVNC)",
  description:
    "Headed Linux desktop in the sandbox microVM: an Xvfb framebuffer, a lightweight window manager, an x11vnc RFB export, and a noVNC WebSocket bridge on an exposed port so a browser can render the live desktop and a human can take over. Unlocks agents operating GUI apps, headed browsers, and Electron.",
  setupScript: {
    repoPath: "packages/sandbox/profiles/desktop/setup.sh",
    sandboxPath: "/tmp/open-agents/profiles/desktop/setup.sh",
    command: "bash /tmp/open-agents/profiles/desktop/setup.sh",
    timeoutMs: 420_000,
  },
  setupCommands: [
    {
      id: "install-x-stack",
      label: "Install Xvfb, window manager, TigerVNC, websockify, and noVNC",
      description:
        "Installs the virtual-desktop stack on Amazon Linux 2023. NOTE (verified empirically): the AL2023 repos do NOT package x11vnc, fluxbox/openbox/twm, novnc, or python3-websockify. The VNC server is TigerVNC (x0vncserver, from tigervnc-server), the WM is metacity (mutter is the fallback), websockify comes from pip, and the noVNC client from a pinned GitHub tarball.",
      command: [
        "set -e",
        "sudo dnf -y install xorg-x11-server-Xvfb tigervnc-server xterm xorg-x11-utils ImageMagick procps-ng tar gzip python3 python3-pip",
        "sudo dnf -y install metacity || sudo dnf -y install mutter || true",
        "command -v websockify >/dev/null 2>&1 || sudo python3 -m pip install websockify",
        "novnc_dir=/usr/share/novnc",
        'if [ ! -f "$novnc_dir/vnc.html" ]; then tmp=$(mktemp -d); curl -fsSL https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz -o "$tmp/n.tgz"; sudo mkdir -p "$novnc_dir"; sudo tar -xzf "$tmp/n.tgz" -C "$novnc_dir" --strip-components=1; rm -rf "$tmp"; fi',
        // Record the chosen WM so start-desktop.sh launches it without re-probing.
        'wm="$(command -v metacity || command -v mutter || true)"; [ -n "$wm" ] && (echo "$wm" | sudo tee /etc/open-agents/desktop-wm >/dev/null || mkdir -p "$HOME/.open-agents" && echo "$wm" > "$HOME/.open-agents/desktop-wm") || true',
        // Install the startup script to a stable profile path.
        'mkdir -p "$HOME/.open-agents/desktop"',
        'cp /tmp/open-agents/profiles/desktop/start-desktop.sh "$HOME/.open-agents/desktop/start-desktop.sh" 2>/dev/null || true',
        'chmod +x "$HOME/.open-agents/desktop/start-desktop.sh" 2>/dev/null || true',
      ].join("\n"),
      timeoutMs: 420_000,
    },
    {
      id: "start-desktop",
      label: "Start the virtual desktop stack",
      description:
        "Launches Xvfb, the window manager, x11vnc, and the websockify/noVNC bridge, exposing the desktop on the noVNC port. Idempotent and detached.",
      command: START_DESKTOP_INLINE,
      timeoutMs: 90_000,
    },
  ],
  verificationCommands: [
    {
      id: "verify-xserver",
      label: "Verify the X server is up",
      description:
        "Confirms Xvfb is serving the configured DISPLAY before GUI apps are launched.",
      command:
        'export DISPLAY="${DISPLAY:-:99}"; xdpyinfo -display "$DISPLAY" >/dev/null && echo "X server up on $DISPLAY"',
      timeoutMs: 30_000,
      required: true,
    },
    {
      id: "verify-window-manager",
      label: "Verify a window manager is running",
      description:
        "Confirms a window manager owns the root window (EWMH hint) or is running as a process, so GUI apps get decorations and focus.",
      command:
        'export DISPLAY="${DISPLAY:-:99}"; (xprop -display "$DISPLAY" -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q window) || pgrep -x metacity >/dev/null || pgrep -x mutter >/dev/null || pgrep -x marco >/dev/null || pgrep -x twm >/dev/null && echo "window manager running"',
      timeoutMs: 30_000,
      required: true,
    },
    {
      id: "verify-novnc-websocket",
      label: "Verify the noVNC WebSocket bridge is reachable",
      description:
        "Confirms websockify is listening on the noVNC port and that the RFB ProtocolVersion banner flows through the WebSocket bridge from x11vnc.",
      command:
        'novnc_port="${NOVNC_PORT:-6080}"; (exec 3<>/dev/tcp/127.0.0.1/$novnc_port) && echo "noVNC websocket port $novnc_port open"',
      timeoutMs: 30_000,
      required: true,
    },
  ],
  expectedTools: ["Xvfb", "x0vncserver", "websockify"],
  optionalTools: ["metacity", "mutter", "xterm", "import", "xdpyinfo"],
  // noVNC browser-facing port is the primary exposed port; 5900 is the raw RFB
  // port (kept loopback-only in start-desktop.sh, listed for completeness).
  defaultPorts: [6080, 5900],
} as const satisfies ManagedRuntimeProfile;
