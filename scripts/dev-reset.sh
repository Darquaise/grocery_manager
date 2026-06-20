#!/usr/bin/env bash
#
# Setzt die lokale Dev-Datenbank zurück: löscht ALLE lokalen DB-Daten (das Volume)
# und startet den Stack mit frischem, neu geseedetem Schema wieder.
#
#   ./scripts/dev-reset.sh         # fragt vorher nach
#   ./scripts/dev-reset.sh -y      # ohne Rückfrage (z. B. für Skripte)
#
# Betrifft nur die LOKALE Dev-DB (compose.dev.yml). Produktiv bleibt unberührt.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"

if [ "${1:-}" != "-y" ] && [ "${1:-}" != "--yes" ]; then
  printf "⚠ Löscht ALLE lokalen Dev-DB-Daten. Fortfahren? [j/N] "
  read -r answer || answer=""
  case "$answer" in
    j | J | y | Y) ;;
    *) echo "Abgebrochen."; exit 0 ;;
  esac
fi

# 1) Laufende Prozesse + DB-Container stoppen (Volume bleibt zunächst).
"$DIR/dev-stop.sh"

# 2) DB-Volume entfernen → alle Daten weg.
echo "▶ Lösche DB-Volume…"
docker compose -f "$ROOT/compose.dev.yml" down -v >/dev/null 2>&1 || true

# 3) Frisch hochfahren (legt Schema neu an + seedet Kategorien/Accounts).
echo "▶ Starte mit frischer Datenbank…"
echo
exec "$DIR/dev-start.sh"
