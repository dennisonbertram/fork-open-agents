#!/usr/bin/env bash
# start-desktop.sh — boot a virtual desktop stack inside a Linux sandbox.
#
# Stack (tuned for what the Amazon Linux 2023 repos actually ship — see
# README "Blind Spots Eliminated"):
#   Xvfb         -> headless X server providing a framebuffer on $DISPLAY
#   metacity     -> lightweight window manager (title bars / focus); the WM is
#                   chosen by setup.sh and recorded in /etc/open-agents/desktop-wm
#   x0vncserver  -> TigerVNC; exports the Xvfb framebuffer over RFB (replaces
#                   x11vnc, which is NOT packaged on AL2023)
#   websockify   -> bridges noVNC (browser WebSocket) <-> x0vncserver (raw TCP)
#   noVNC        -> static HTML/JS client served by websockify on $NOVNC_PORT
#
# Design notes for the managed runtime:
#   * Idempotent: re-running kills stale PIDs and relaunches cleanly.
#   * Detached: every long-lived process is backgrounded; the script returns 0
#     once the stack is up, so it works under Sandbox.execDetached / a profile
#     startup command.
#   * Observable: PIDs, logs, and a machine-readable status file land under
#     $DESKTOP_STATE_DIR so verificationCommands (and the web app) can inspect
#     the desktop service the same way sandboxServices tracks a dev server.
set -euo pipefail

# ---- configuration (overridable via env) -----------------------------------
export DISPLAY="${DISPLAY:-:99}"
SCREEN_GEOMETRY="${SCREEN_GEOMETRY:-1280x800x24}"
VNC_PORT="${VNC_PORT:-5900}"          # raw RFB port (loopback only)
NOVNC_PORT="${NOVNC_PORT:-6080}"      # browser-facing WebSocket/HTTP port (exposed)
DESKTOP_STATE_DIR="${DESKTOP_STATE_DIR:-/tmp/open-agents/desktop}"
NOVNC_WEB_ROOT="${NOVNC_WEB_ROOT:-/usr/share/novnc}"

LOG_DIR="$DESKTOP_STATE_DIR/logs"
PID_DIR="$DESKTOP_STATE_DIR/pids"
STATUS_FILE="$DESKTOP_STATE_DIR/status.json"
mkdir -p "$LOG_DIR" "$PID_DIR"

log() { printf '[start-desktop] %s\n' "$*"; }

websockify_cmd() {
  if command -v websockify >/dev/null 2>&1; then
    echo "websockify"
  elif python3 -c 'import websockify' >/dev/null 2>&1; then
    echo "python3 -m websockify"
  else
    return 1
  fi
}

resolve_novnc_root() {
  for candidate in "$NOVNC_WEB_ROOT" /usr/share/novnc /usr/share/webapps/novnc \
    "$HOME/.open-agents/novnc"; do
    if [ -f "$candidate/vnc.html" ] || [ -f "$candidate/vnc_lite.html" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_wm() {
  # setup.sh records the chosen WM; otherwise probe known-good AL2023 WMs.
  for f in /etc/open-agents/desktop-wm "$HOME/.open-agents/desktop-wm"; do
    if [ -f "$f" ]; then
      local wm
      wm="$(cat "$f" 2>/dev/null)"
      if [ -n "$wm" ] && command -v "$wm" >/dev/null 2>&1; then
        echo "$wm"
        return 0
      fi
    fi
  done
  for wm in metacity mutter marco twm openbox fluxbox icewm; do
    if command -v "$wm" >/dev/null 2>&1; then
      echo "$wm"
      return 0
    fi
  done
  return 1
}

kill_pidfile() {
  local f="$1"
  if [ -f "$f" ]; then
    local pid
    pid="$(cat "$f" 2>/dev/null || true)"
    if [ -n "${pid:-}" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$f"
  fi
}

wait_for() { # wait_for <description> <max_seconds> <command...>
  local desc="$1" max="$2"
  shift 2
  local i=0
  while [ "$i" -lt "$max" ]; do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  log "TIMEOUT waiting for: $desc"
  return 1
}

tcp_open() { bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null; }

# ---- teardown of any previous run ------------------------------------------
log "DISPLAY=$DISPLAY geometry=$SCREEN_GEOMETRY vnc=$VNC_PORT novnc=$NOVNC_PORT"
for name in websockify x0vncserver wm Xvfb; do
  kill_pidfile "$PID_DIR/$name.pid"
done
rm -f "/tmp/.X${DISPLAY#:}-lock" 2>/dev/null || true

# ---- 1. Xvfb: the virtual framebuffer X server -----------------------------
log "starting Xvfb"
Xvfb "$DISPLAY" -screen 0 "$SCREEN_GEOMETRY" -nolisten tcp -ac \
  </dev/null >"$LOG_DIR/xvfb.log" 2>&1 &
echo $! >"$PID_DIR/Xvfb.pid"
wait_for "X server ($DISPLAY)" 15 xdpyinfo -display "$DISPLAY"

# ---- 2. window manager -----------------------------------------------------
WM="$(resolve_wm || true)"
if [ -n "${WM:-}" ]; then
  log "starting window manager: $WM"
  # metacity/mutter benefit from --replace; harmless to try then fall back.
  ("$WM" --replace </dev/null >"$LOG_DIR/wm.log" 2>&1 || "$WM" </dev/null >"$LOG_DIR/wm.log" 2>&1) &
  echo $! >"$PID_DIR/wm.pid"
  sleep 2
else
  log "WARNING: no window manager available; running WM-less"
fi

# ---- 3. x0vncserver (TigerVNC): export the framebuffer over RFB ------------
log "starting x0vncserver on 127.0.0.1:$VNC_PORT"
# TigerVNC parameter style: -display, -rfbport, -localhost yes,
# -SecurityTypes None (no auth — POC only; gate in production).
x0vncserver -display "$DISPLAY" -rfbport "$VNC_PORT" \
  -localhost yes -SecurityTypes None -AlwaysShared=1 \
  </dev/null >"$LOG_DIR/x0vncserver.log" 2>&1 &
echo $! >"$PID_DIR/x0vncserver.pid"
if ! wait_for "x0vncserver RFB port $VNC_PORT" 15 tcp_open "$VNC_PORT"; then
  log "x0vncserver did not bind; retrying with minimal flags"
  kill_pidfile "$PID_DIR/x0vncserver.pid"
  x0vncserver -display "$DISPLAY" -rfbport "$VNC_PORT" -SecurityTypes None \
    </dev/null >"$LOG_DIR/x0vncserver.log" 2>&1 &
  echo $! >"$PID_DIR/x0vncserver.pid"
  wait_for "x0vncserver RFB port $VNC_PORT (retry)" 15 tcp_open "$VNC_PORT"
fi

# ---- 4. websockify + noVNC: browser-facing bridge --------------------------
WS="$(websockify_cmd)" || { log "FATAL: websockify not found"; exit 1; }
NOVNC_ROOT="$(resolve_novnc_root || true)"
log "starting websockify ($WS) on 0.0.0.0:$NOVNC_PORT -> 127.0.0.1:$VNC_PORT"
if [ -n "${NOVNC_ROOT:-}" ]; then
  log "serving noVNC client from $NOVNC_ROOT"
  # shellcheck disable=SC2086
  $WS --web "$NOVNC_ROOT" "0.0.0.0:$NOVNC_PORT" "127.0.0.1:$VNC_PORT" \
    </dev/null >"$LOG_DIR/websockify.log" 2>&1 &
else
  log "noVNC web root not found; running pure WebSocket bridge (RFB still proxied)"
  # shellcheck disable=SC2086
  $WS "0.0.0.0:$NOVNC_PORT" "127.0.0.1:$VNC_PORT" \
    </dev/null >"$LOG_DIR/websockify.log" 2>&1 &
fi
echo $! >"$PID_DIR/websockify.pid"
wait_for "websockify port $NOVNC_PORT" 15 tcp_open "$NOVNC_PORT"

# ---- status file (model: sandboxServices row) ------------------------------
xvfb_pid="$(cat "$PID_DIR/Xvfb.pid" 2>/dev/null || echo "")"
wm_pid="$(cat "$PID_DIR/wm.pid" 2>/dev/null || echo "")"
vnc_pid="$(cat "$PID_DIR/x0vncserver.pid" 2>/dev/null || echo "")"
ws_pid="$(cat "$PID_DIR/websockify.pid" 2>/dev/null || echo "")"
cat >"$STATUS_FILE" <<JSON
{
  "kind": "desktop",
  "status": "running",
  "display": "$DISPLAY",
  "geometry": "$SCREEN_GEOMETRY",
  "windowManager": "${WM:-none}",
  "vncServer": "x0vncserver",
  "vncPort": $VNC_PORT,
  "novncPort": $NOVNC_PORT,
  "novncRoot": "${NOVNC_ROOT:-}",
  "healthPath": "/vnc.html",
  "pids": {
    "xvfb": "$xvfb_pid",
    "windowManager": "$wm_pid",
    "x0vncserver": "$vnc_pid",
    "websockify": "$ws_pid"
  },
  "logDir": "$LOG_DIR"
}
JSON

log "desktop stack is up"
log "  noVNC viewer: http://<sandbox-domain-for-$NOVNC_PORT>/vnc.html"
log "  status file:  $STATUS_FILE"
cat "$STATUS_FILE"
