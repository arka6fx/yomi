#!/bin/bash
# Desktop stack for the Yomi computer: virtual display, window manager,
# VNC server (human viewer/takeover), Chromium, and the agent control API.
set -euo pipefail

WIDTH="${YOMI_DESKTOP_WIDTH:-1280}"
HEIGHT="${YOMI_DESKTOP_HEIGHT:-800}"

rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 "${WIDTH}x${HEIGHT}x24" >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
sleep 2

export DISPLAY=:99
openbox >/tmp/openbox.log 2>&1 &
x11vnc -display :99 -forever -shared -nopw -listen localhost -xkb -rfbport 5900 \
  >/tmp/x11vnc.log 2>&1 &
# Live view / take-over: the gateway bridges the dashboard's websocket to here.
websockify 6080 localhost:5900 >/tmp/websockify.log 2>&1 &

mkdir -p /home/yomi

# Chrome starts on demand (control/chrome.py) after the gateway restores the
# saved profile, so logins survive the desktop sleeping.
python3 /opt/yomi/control/server.py &

wait "$XVFB_PID"
