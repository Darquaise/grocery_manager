#!/usr/bin/env bash
#
# Stoppt den lokalen Stack: Frontend, Backend und die lokale Postgres.
# Die lokalen DB-Daten bleiben dabei erhalten (Volume wird nicht gelöscht).
#
#   ./scripts/dev-stop.sh
#
# DB komplett zurücksetzen (Daten löschen): ./scripts/dev-reset.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RUN_DIR="$ROOT/.dev"

# Beendet einen Prozess samt aller Kindprozesse (uvicorn-Reloader, ng serve, …).
kill_tree() {
  local pid="$1" child
  [ -n "$pid" ] || return 0
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

stop_proc() {
  local name="$1"
  local pidfile="$RUN_DIR/$name.pid" pid
  [ -f "$pidfile" ] || return 0
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "▶ Stoppe $name (PID $pid)…"
    kill_tree "$pid"
  fi
  rm -f "$pidfile"
}

stop_proc frontend
stop_proc backend

# Sicherheitsnetz: alles beenden, was noch auf den Dev-Ports hängt.
for port in 4200 8000; do
  pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "▶ Räume Port ${port}…"
    for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  fi
done

echo "▶ Stoppe Datenbank (Daten bleiben erhalten)…"
docker compose -f compose.dev.yml down

echo "✓ Gestoppt."
