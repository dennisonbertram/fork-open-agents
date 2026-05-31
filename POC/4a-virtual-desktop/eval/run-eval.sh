#!/usr/bin/env bash
# run-eval.sh — stand up the desktop stack and PROVE it streams a live desktop.
#
# Assertions:
#   A. start-desktop.sh brings up Xvfb + WM + x11vnc + websockify (exit 0).
#   B. A real GUI app (xterm) launches on the Xvfb DISPLAY and is captured as a
#      non-blank PNG framebuffer screenshot (assert-image.py).
#   C. The noVNC WebSocket endpoint completes a WS handshake and yields the RFB
#      ProtocolVersion banner (ws-rfb-probe.py) — proving the live bridge.
#   D. The profile verificationCommands all pass.
#
# Evidence is written to /home/sandbox/poc/evidence and copied out by the host.
set -uo pipefail

POC=/home/sandbox/poc
EV="$POC/evidence"
mkdir -p "$EV"
export DISPLAY="${DISPLAY:-:99}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export VNC_PORT="${VNC_PORT:-5900}"
fail=0

echo "==================================================================="
echo "POC 4a virtual-desktop eval — $(date -u +%FT%TZ)"
echo "==================================================================="

# ---- A. start the desktop stack --------------------------------------------
echo; echo "### A. start-desktop.sh"
# Redirect to a file (not a pipe) so backgrounded daemons that inherit fds
# can't hold a pipe open and block us; then echo the log.
bash "$POC/scripts/start-desktop.sh" </dev/null >"$EV/start-desktop.log" 2>&1
start_rc=$?
cat "$EV/start-desktop.log"
echo "start-desktop.sh exit=$start_rc"
[ "$start_rc" -eq 0 ] || fail=1
cp -f /tmp/open-agents/desktop/status.json "$EV/status.json" 2>/dev/null || true

# ---- B. launch a GUI app + screenshot the framebuffer ----------------------
echo; echo "### B. launch xterm + capture framebuffer"
# A visible xterm running a colorful command gives the framebuffer real content.
xterm -geometry 100x30+40+40 -bg navy -fg white \
  -e bash -c 'echo "OPEN-AGENTS POC 4a — live virtual desktop"; \
              echo "DISPLAY=$DISPLAY  host=$(hostname)"; \
              date; ls --color=always /; sleep 600' \
  </dev/null >/dev/null 2>&1 &
xterm_pid=$!
sleep 4
echo "xterm pid=$xterm_pid"
xdotool getdisplaygeometry 2>/dev/null || true
# Capture the whole root window of the Xvfb display.
if import -display "$DISPLAY" -window root "$EV/desktop.png" 2>>"$EV/screenshot.log"; then
  echo "screenshot captured via ImageMagick import"
elif xwd -root -display "$DISPLAY" -out "$EV/desktop.xwd" 2>>"$EV/screenshot.log" \
     && convert "$EV/desktop.xwd" "$EV/desktop.png" 2>>"$EV/screenshot.log"; then
  echo "screenshot captured via xwd+convert"
else
  echo "screenshot FAILED"; fail=1
fi
if [ -f "$EV/desktop.png" ]; then
  python3 "$POC/eval/assert-image.py" "$EV/desktop.png" | tee "$EV/image-assert.txt"
  [ "${PIPESTATUS[0]}" -eq 0 ] || fail=1
else
  echo "no screenshot to assert"; fail=1
fi

# ---- C. prove the noVNC WebSocket -> RFB bridge is live --------------------
echo; echo "### C. noVNC WebSocket RFB handshake"
NOVNC_PORT="$NOVNC_PORT" python3 "$POC/eval/ws-rfb-probe.py" 2>&1 \
  | tee "$EV/vnc-handshake.txt"
[ "${PIPESTATUS[0]}" -eq 0 ] || fail=1
# Also confirm the noVNC client HTML is served over HTTP (the human's viewport).
if curl -fsS "http://127.0.0.1:$NOVNC_PORT/vnc.html" -o /dev/null 2>>"$EV/novnc-http.log"; then
  echo "noVNC vnc.html served over HTTP: OK" | tee -a "$EV/vnc-handshake.txt"
else
  echo "noVNC vnc.html HTTP check: not served (bridge still proven by RFB banner)" \
    | tee -a "$EV/vnc-handshake.txt"
fi

# ---- D. run the profile verificationCommands -------------------------------
echo; echo "### D. profile verificationCommands"
{
  echo "## verify-xserver"
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 \
    && echo "PASS: X server responds on $DISPLAY" || { echo "FAIL: X server"; fail=1; }

  echo "## verify-window-manager"
  if xprop -display "$DISPLAY" -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q window \
     || xprop -display "$DISPLAY" -root 2>/dev/null | grep -qiE '_NET_WM|Fluxbox|Openbox'; then
    echo "PASS: a window manager owns the root window"
  else
    # twm sets no EWMH hints; fall back to process check.
    if pgrep -x fluxbox >/dev/null || pgrep -x openbox >/dev/null || pgrep -x twm >/dev/null; then
      echo "PASS: window manager process running (no EWMH hints)"
    else
      echo "FAIL: no window manager"; fail=1
    fi
  fi

  echo "## verify-vncserver"
  (exec 3<>/dev/tcp/127.0.0.1/"$VNC_PORT") 2>/dev/null \
    && echo "PASS: x0vncserver RFB port $VNC_PORT open" || { echo "FAIL: vnc port"; fail=1; }

  echo "## verify-novnc-websocket"
  (exec 3<>/dev/tcp/127.0.0.1/"$NOVNC_PORT") 2>/dev/null \
    && echo "PASS: noVNC websocket port $NOVNC_PORT open" || { echo "FAIL: novnc port"; fail=1; }
} | tee "$EV/verification.txt"

# ---- timing + summary ------------------------------------------------------
echo; echo "### timings"
cp -f "$POC/setup-timing.txt" "$EV/setup-timing.txt" 2>/dev/null || true
cat "$EV/setup-timing.txt" 2>/dev/null || echo "SETUP_SECONDS=unknown"

echo; echo "==================================================================="
if [ "$fail" -eq 0 ]; then
  echo "RESULT: PASS — live virtual desktop proven end-to-end"
else
  echo "RESULT: FAIL — see evidence/*.log"
fi
echo "==================================================================="
exit "$fail"
