#!/usr/bin/env bash
#
# Startet den lokalen Stack neu (= dev-stop.sh + dev-start.sh).
# Die lokalen DB-Daten bleiben erhalten.
#
#   ./scripts/dev-restart.sh
#
# DB zurücksetzen (Daten löschen): ./scripts/dev-reset.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$DIR/dev-stop.sh"
echo
exec "$DIR/dev-start.sh"
