#!/usr/bin/env bash
#
# Startet den kompletten Stack LOKAL und offline:
#   - Postgres in Docker (compose.dev.yml) — keine Server-DB nötig
#   - Backend  (FastAPI / uvicorn --reload, Port 8000)
#   - Frontend (Angular dev server, Port 4200, proxyt /api -> :8000)
#
# Aufruf:   ./scripts/dev-start.sh
# App:      http://localhost:4200
# Logs:     .dev/backend.log  ·  .dev/frontend.log
# Stoppen:  ./scripts/dev-stop.sh
#
# Hinweis: Produktiv bleibt unberührt (compose.yml -> echte geteilte Postgres).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_DIR="$ROOT/.dev"
mkdir -p "$RUN_DIR"

# Lokale DB-URL — wird dem Backend als echte Env-Var übergeben und hat damit
# Vorrang vor allem, was in .env steht. So geht lokal NIE die Server-DB an.
DEV_DB_URL="postgresql+psycopg://grocery_app:grocery@localhost:5432/grocery"
BACKEND_PORT=8000
FRONTEND_PORT=4200

for tool in docker uv npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "✗ '$tool' nicht gefunden."; exit 1; }
done
docker info >/dev/null 2>&1 || { echo "✗ Docker-Daemon läuft nicht (z. B. 'colima start')."; exit 1; }

if [ ! -f "$ROOT/.env" ]; then
  echo "⚠ Keine .env gefunden — ohne USER1_*/USER2_* werden keine Login-Accounts geseedet."
  echo "  Tipp: cp .env.example .env  und Accounts ausfüllen."
fi

# Erstinstallation der Abhängigkeiten nur, falls sie fehlen (einmalig online).
[ -d "$ROOT/backend/.venv" ]         || ( echo "▶ uv sync (einmalig)…";  cd "$ROOT/backend"  && uv sync )
[ -d "$ROOT/frontend/node_modules" ] || ( echo "▶ npm ci (einmalig)…";   cd "$ROOT/frontend" && npm ci )

# 1) Datenbank starten und auf "healthy" warten.
echo "▶ Datenbank (Docker)…"
docker compose -f compose.dev.yml up -d --wait

# Startet einen Hintergrundprozess mit PID-Datei + Logfile (überlebt Skript-Ende).
start_bg() {  # name workdir command...
  local name="$1" dir="$2"; shift 2
  local pidfile="$RUN_DIR/$name.pid" logfile="$RUN_DIR/$name.log"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile" 2>/dev/null)" 2>/dev/null; then
    echo "  $name läuft bereits (PID $(cat "$pidfile"))."
    return
  fi
  ( cd "$dir" && exec nohup "$@" ) >"$logfile" 2>&1 &
  echo $! >"$pidfile"
  disown %% 2>/dev/null || true
  echo "  $name → PID $!  ·  Log: ${logfile#"$ROOT"/}"
}

# 2) Schema per Alembic (wie Produktiv) — inkrementelle Migrationen statt
#    create_all, damit Schema-Änderungen ohne DB-Reset ankommen.
echo "▶ Datenbank-Migrationen (alembic upgrade head)…"
( cd "$ROOT/backend" && env DATABASE_URL="$DEV_DB_URL" uv run alembic upgrade head )

# 3) Backend — DATABASE_URL erzwingt die lokale DB; DB_AUTO_CREATE=false, weil
#    jetzt Alembic das Schema besitzt (deckt fehlende Migrationen früh auf).
echo "▶ Backend (FastAPI, :$BACKEND_PORT)…"
start_bg backend "$ROOT/backend" \
  env DATABASE_URL="$DEV_DB_URL" DB_AUTO_CREATE=false \
  uv run uvicorn app.main:app --reload --port "$BACKEND_PORT"

# 4) Frontend — Angular dev server (proxyt /api auf das Backend).
echo "▶ Frontend (Angular, :$FRONTEND_PORT)…"
start_bg frontend "$ROOT/frontend" npm start -- --port "$FRONTEND_PORT"

# Auf das Backend warten (Frontend kompiliert im Hintergrund weiter).
printf "▶ Warte auf das Backend"
if curl -fsS --retry 30 --retry-delay 1 --retry-all-errors --retry-connrefused \
  "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
  echo "  ✓"
else
  echo "  ✗ — siehe .dev/backend.log"
fi

cat <<EOF

✓ Gestartet.
   App:      http://localhost:$FRONTEND_PORT   (kann ~10–20 s kompilieren)
   API:      http://localhost:$BACKEND_PORT/api
   Logs:     tail -f .dev/backend.log .dev/frontend.log
   Stoppen:  ./scripts/dev-stop.sh
EOF
