#!/bin/bash
# install-auto.sh — hands-off RTL install/uninstall for Claude Desktop (macOS).
#
# Made for a Claude Code agent that is ITSELF running inside Claude Desktop.
# The agent cannot quit/re-sign the app it lives in, so this script re-launches
# itself as a DETACHED process (its own session, reparented to launchd) that
# survives Claude Desktop being quit. It then runs, in order:
#
#     quit Claude  ->  node patch.mjs / unpatch.mjs  ->  relaunch Claude
#
# The agent's session pauses while Claude restarts and resumes afterward.
# Progress is written to the log; check it once Claude is back.
#
# Usage:
#   bash install-auto.sh              # install the RTL patch
#   bash install-auto.sh uninstall    # remove it
# Humans with a normal terminal can run this too.

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="${RTL_LOG:-/tmp/claude-rtl-install.log}"

# ---------------- launcher (foreground) ----------------
if [ "${1:-}" != "--detached" ]; then
  MODE="install"
  [ "${1:-}" = "uninstall" ] && MODE="uninstall"

  NODE_BIN="$(command -v node || true)"
  if [ -z "$NODE_BIN" ]; then
    echo "ERROR: 'node' not found on PATH. Install Node 18+ and retry." >&2
    exit 1
  fi
  if [ ! -d "$DIR/node_modules/@electron/asar" ]; then
    echo "Installing dependencies (npm install)…"
    ( cd "$DIR" && npm install ) || { echo "ERROR: npm install failed" >&2; exit 1; }
  fi
  : > "$LOG"
  # Relaunch self fully detached: new session (setsid) + nohup + no stdio, so it
  # outlives this shell AND Claude Desktop. macOS has no setsid(1); use perl.
  RTL_DIR="$DIR" RTL_NODE="$NODE_BIN" RTL_LOG="$LOG" RTL_MODE="$MODE" \
    nohup perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' \
    bash "$DIR/install-auto.sh" --detached >>"$LOG" 2>&1 </dev/null &
  disown 2>/dev/null || true
  echo "RTL $MODE launched in the background (detached)."
  echo "It will: quit Claude Desktop → $MODE → relaunch Claude Desktop."
  echo "If you are Claude Code: your session will pause when Claude quits and"
  echo "resume after it relaunches (~30–60s). Do NOT quit/kill Claude yourself."
  echo "Progress log: $LOG"
  exit 0
fi

# ---------------- detached body ----------------
DIR="${RTL_DIR:-$DIR}"
NODE="${RTL_NODE:-node}"
MODE="${RTL_MODE:-install}"
cd "$DIR" || exit 1
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

SCRIPT="patch.mjs"; [ "$MODE" = "uninstall" ] && SCRIPT="unpatch.mjs"
log "detached $MODE running (pid $$, own session)"

log "quitting Claude Desktop…"
osascript -e 'quit app "Claude"' >/dev/null 2>&1 || true
for _ in $(seq 1 25); do
  pgrep -f "/Applications/Claude.app/Contents/MacOS/Claude" >/dev/null 2>&1 || break
  sleep 1
done
# Force any stragglers. This pattern matches only the desktop app under
# /Applications — NOT the claude-code CLI (which lives under ~/Library/...).
for p in $(pgrep -f "/Applications/Claude.app/Contents/" 2>/dev/null); do
  kill -9 "$p" 2>/dev/null || true
done
sleep 3
if pgrep -f "/Applications/Claude.app/Contents/MacOS/Claude" >/dev/null 2>&1; then
  log "WARNING: Claude still appears to be running; re-signing may fail."
fi

log "running node $SCRIPT…"
if "$NODE" "$DIR/$SCRIPT" >>"$LOG" 2>&1; then
  log "$MODE OK"
else
  log "ERROR: $SCRIPT failed (see output above). Relaunching Claude anyway."
fi

log "relaunching Claude Desktop…"
open -a "/Applications/Claude.app" 2>>"$LOG" || log "WARNING: could not open Claude; open it manually."
log "[✓] done ($MODE)"
