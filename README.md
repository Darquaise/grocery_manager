# Grocery Manager

Private, mobile-first **PWA** für genau 2 Personen, um Küchen-Verbrauchsmaterialien
(Lebensmittel/Vorräte) zu verwalten und automatisch eine Einkaufsliste zu erzeugen.

- **Produktspezifikation / Konzept:** [`PLAN.md`](./PLAN.md) ← die fachliche Wahrheit.
- **Backend-Dev-Doku:** [`backend/README.md`](./backend/README.md).
- **Server-/Infrastruktur:** Schwester-Repo [`../main-server-infra`](../main-server-infra) (geteilte Postgres, nginx, TLS) — **bereits live** auf ep3o.

> **Stand: 2026-06-20** — **Phase 1 + 2 aus `PLAN.md` umgesetzt** und end-to-end
> verifiziert (Backend-`pytest` 23 grün, Angular-Prod-Build grün, Docker-Container-
> Smoke-Test grün inkl. Login → Auto-Einkaufsliste → Trip-Abschluss → Archiv).
> Offen bleibt nur noch die **optionale Phase 3** (Web-Push, MHD) und mehr Tests/CI.

---

## Tech-Stack

| Schicht | Wahl |
|---|---|
| Backend | **Python 3.14 · FastAPI · SQLModel · Alembic** (Paketmanager **uv**) |
| Auth | argon2-Hash, httpOnly **Session-Cookie** (Starlette `SessionMiddleware`) |
| Frontend | **Angular 20** (standalone + signals) · **Tailwind v4** · **PWA** (Service Worker) |
| DB | **PostgreSQL** (geteilte Instanz auf ep3o, DB `grocery`) |
| Auslieferung | **ein Container**: FastAPI liefert API **und** das gebaute Angular (`/app/static`) aus → ein Origin, kein CORS |

Bewusste Architektur-Entscheidungen (Warum) stehen in `PLAN.md` §5. Kurzfassung:
Resilient-Online statt Voll-Offline, keine Bildspeicherung, 2 fest geseedete Accounts.

---

## Deployment-Architektur

Die App ist **ein** Container hinter dem Host-nginx von **ep3o** (`49.13.192.89`):

```
Internet ──443──> Host-nginx (ep3o)  shopping.darquaise.com
                     │ proxy_pass
                     ▼
            127.0.0.1:8000   grocery-Container (FastAPI + Angular)
                     │ Docker-Netz "shared-db"
                     ▼
            shared-postgres (DB `grocery`, Rolle `grocery_app`)
```

Postgres, das `shared-db`-Netz, die nginx-vhosts und TLS gehören **nicht** hierher,
sondern zu `../main-server-infra` (dort schon eingerichtet). Auf ep3o existieren
bereits: die **`grocery`-DB + Rolle** und der **`shopping.darquaise.com`-vhost**
(liefert 502, bis der Container läuft).

---

## Projektstruktur

```
grocery_manager/
├─ PLAN.md                 # Produkt-/Konzeptspezifikation (maßgeblich)
├─ README.md               # dieses Dokument
├─ compose.yml             # App-Container, joint shared-db, Port 127.0.0.1:8000
├─ Dockerfile              # multi-stage: node baut Angular → python/uv serviert via FastAPI
├─ .dockerignore
├─ .env / .env.example     # .env ist gitignored (Secrets)
├─ backend/
│  ├─ pyproject.toml · uv.lock · .python-version
│  ├─ alembic.ini · migrations/        # Alembic (noch keine Revision generiert)
│  └─ app/
│     ├─ main.py           # FastAPI-App, SPA-Mount + SPA-Fallback, lifespan(create_all+seed)
│     ├─ config.py         # pydantic-settings (DATABASE_URL, SESSION_SECRET, USER1/2_*)
│     ├─ db.py · models.py · security.py · seed.py
│     └─ api/{auth,categories,products,shopping}.py
└─ frontend/               # Angular-Workspace (ng new)
   ├─ proxy.conf.json      # ng serve: /api → http://localhost:8000
   └─ src/app/
      ├─ app.{ts,html}     # Shell mit Bottom-Nav (Bestand/Einkauf/Archiv/Mehr)
      ├─ app.routes.ts · app.config.ts
      ├─ services/auth.ts  # Session-Cookie, currentUser-Signal
      ├─ guards/auth-guard.ts
      └─ pages/{login,inventory,shopping,archive,settings}/
```

---

## Lokal entwickeln

**Voraussetzungen:** `colima` läuft (Docker-Daemon), `uv`, Node 24. Hinweis: `docker
compose` ist hier per Symlink in `~/.docker/cli-plugins/` aktiviert; falls weg,
neu verlinken (`ln -sfn /opt/homebrew/bin/docker-compose ~/.docker/cli-plugins/docker-compose`).

**Schnellster Weg — ein Befehl, komplett offline** (lokale Postgres in Docker +
Backend + Frontend, alles mit Hot-Reload; die echte Server-DB wird **nicht**
berührt):
```bash
./scripts/dev-start.sh      # → http://localhost:4200  (API auf :8000)
./scripts/dev-stop.sh       # alles stoppen (lokale DB-Daten bleiben erhalten)
./scripts/dev-restart.sh    # = stop + start (DB-Daten bleiben erhalten)
./scripts/dev-reset.sh      # DB zurücksetzen (Daten löschen) + frisch starten
```
Die lokale DB läuft via `compose.dev.yml` (eigener Compose-Stack `grocery-dev`,
isoliert von Prod) und **persistiert über Stop/Restart** in einem Docker-Volume.
Nur `dev-reset.sh` löscht die Daten. Das Start-Skript erzwingt `DATABASE_URL` auf
die lokale DB und legt das Schema per `create_all` an (kein Alembic-Schritt nötig).
Logs: `.dev/*.log`.

**Manuell (Alternative, zwei Terminals):** braucht eine erreichbare Postgres unter
`localhost:5432` — entweder Tunnel auf die echte (`ssh -L 5432:127.0.0.1:5432 ep3o`)
oder eine Wegwerf-DB (`docker compose -f compose.dev.yml up -d`), dann:
```bash
cd /Users/kofidiering/projects/grocery_manager/backend && uv run uvicorn app.main:app --reload
cd /Users/kofidiering/projects/grocery_manager/frontend && npm start      # http://localhost:4200
```

**`.env`** (gitignored) existiert lokal bereits: `GROCERY_DB_PASSWORD` und
`SESSION_SECRET` sind gesetzt, **`USER1_*`/`USER2_*` sind leer** → vor dem ersten
Start ausfüllen (Name + Passwort), sonst werden keine Accounts geseedet.

---

## Image bauen & auf ep3o deployen

```bash
# Lokal bauen + im Container testen (gegen SQLite, ohne echte DB):
docker compose build
docker run --rm -p 18000:8000 -e DATABASE_URL='sqlite:////tmp/g.db' -e SESSION_SECRET=x grocery-manager-app

# Deploy auf ep3o:
#  1. Repo (ohne node_modules/.venv/dist) nach ep3o rsyncen, z.B. /opt/grocery_manager
#  2. .env dort anlegen: GROCERY_DB_PASSWORD (== main-server-infra/.env!), SESSION_SECRET, USER1/2_*
#  3. docker compose up -d --build      # baut auf ep3o, joint shared-db, Port 127.0.0.1:8000
#  4. Zertifikat ziehen (im infra-Repo):
#     cd /opt/main-server-infra && set -a; . ./.env; set +a
#     ./tls/issue-cert.sh shopping.darquaise.com www.shopping.darquaise.com
```
`grocery`-DB + Rolle existieren auf ep3o schon. Das `GROCERY_DB_PASSWORD` steht in
`main-server-infra/.env` (ep3o) und in der lokalen `grocery_manager/.env` — beide
müssen identisch sein. **Nicht** ins Git.

---

## Was schon steht (verifiziert)

- **Backend** — volle Fachlogik, nicht mehr nur Stubs:
  - **Produkte**: CRUD + Soft-Delete/Restore + `adjust` (Verbrauchen/Auffüllen),
    alle 3 Tracking-Typen, `min_value`/Status-Schwelle, `step`, `full_value`.
  - **Auto-Einkaufsliste** (`app/shopping_logic.py`): `current_value <= min_value`
    → Auto-Eintrag; Snooze-Lifecycle (`ignored_until_restock`) bis Wiederauffüllen.
  - **Einkaufen**: Abhaken (`open`↔`inCart`), Auto-Snooze beim Wegwischen,
    **Trip abschließen → Archiv** mit „Voll"-Wert-Logik + optionalem Gesamtpreis.
  - **Kategorien**: CRUD (Delete setzt Produkt-Kategorie auf `null`). **Users**: Liste
    + eigene Farbe. Geprüft: `ruff` + **`pytest` (23 Tests grün)**.
- **Alembic**: Initialmigration `migrations/versions/*_init.py` ist die Schema-Wahrheit;
  Container fährt beim Start `alembic upgrade head` (compose: `DB_AUTO_CREATE=false`),
  lokal bleibt `create_all` als Dev-Komfort (`DB_AUTO_CREATE=true`, Default).
- **Frontend** (Angular-Prod-Build grün): App-Shell + Bottom-Nav, `authGuard`, Login,
  **Bestand** (Kategorie-Gruppierung, Lagerort-Filter, Suche, Knapp-Markierung),
  **Produkt-Detail** (anlegen/bearbeiten/±-Buttons/„Voll"/Soft-Delete), **Einkaufsliste**
  (Optimistic-Abhaken + Retry-Queue + localStorage-Cache, Autovervollständigung,
  Farbmarkierung, Trip-Abschluss), **Archiv**, **Einstellungen** (Kategorien-CRUD,
  Nutzerfarben, Logout). PWA: Service Worker, Manifest + Icons (neu generiert).
- **Docker**: kombiniertes Image baut; Container-Smoke-Test grün — SPA + Deep-Links
  + ganzer API-Fluss (Login → Auto-Liste → Trip → Archiv) gegen SQLite verifiziert.
- Auf ep3o: Postgres + `grocery`-DB + vhost + Platzhalter-Apex live (siehe infra-Repo).

---

## Was noch zu tun ist (priorisiert)

1. **Deploy**: Repo nach ep3o, `.env` füllen (`USER1/2_*`!), `docker compose up -d --build`,
   TLS-Cert ziehen (siehe „Image bauen & deployen"). CI deployt zudem auto bei Push auf `main`.
2. **Mehr Tests**: Frontend-Unit-/Component-Tests; backend-Abdeckung erweitern; simple CI.
3. **Phase 3 (optional)**: Web-Push (VAPID, iOS 16.4+), MHD/Haltbarkeit (`expiry_date`
   ist im Modell schon vorgesehen), evtl. Voll-Offline.

Erledigt sind damit die früheren Punkte 1–3 (Alembic, Fachlogik, Frontend-Screens).

---

## Meine Gedanken / Hinweise für den nächsten Durchgang

- **Das hier ist ein Skelett, kein MVP.** Routing, Auth, DB-Anbindung, Build und Deploy
  stehen und sind getestet — aber die Bestands-/Einkaufslisten-Logik (der Sinn der App)
  fehlt noch fast komplett. Nächster sinnvoller Brocken: **Produkte-CRUD + Produkt-Detail
  end-to-end** (Backend-Endpunkte sind schon da), dann **Auto-Einkaufsliste**.
- **create_all vs. Alembic:** Solange noch keine Migration existiert, legt die App die
  Tabellen beim Start selbst an (`create_all`). Das ist praktisch fürs Hacken, aber für
  Prod soll **Alembic** die Wahrheit sein — Migration zuerst erzeugen, dann umstellen.
- **SPA-Fallback-Falle (gelöst, nicht wieder einbauen):** Starlettes `StaticFiles` *wirft*
  bei 404 eine `HTTPException`, statt eine Response mit Status 404 zu liefern. Der Fallback
  in `main.py` fängt die Exception ab — beim Refactoring nicht auf `status_code` zurückfallen.
- **Auth/Sicherheit:** Cookie ist `https_only=False`, weil die App hinter dem TLS-nginx
  http sieht. Für etwas mehr Härte später X-Forwarded-Proto auswerten und Secure-Cookie
  setzen. Security ist laut PLAN bewusst niedrig priorisiert (2 private Nutzer).
- **Secrets-Sync:** `GROCERY_DB_PASSWORD` muss in `grocery_manager/.env` **und**
  `main-server-infra/.env` (ep3o) gleich sein. `SESSION_SECRET` ist pro Umgebung eigen.
- **Sprache:** UI ist Deutsch-only (keine i18n nötig).
- **Build-Ort:** Das Docker-Image lokal *oder* auf ep3o bauen (kein Registry vorhanden);
  auf dem 7,6-GB-Server ist der Angular-Build im Container unkritisch.
- **Kontext für Folgesessions:** Es gibt zwei Memory-Notizen (`server-infra`, `grocery-stack`),
  die Infrastruktur, Stack und Stolpersteine festhalten.

---

## Verwandte Repos / Dokumente

- [`PLAN.md`](./PLAN.md) — Produktkonzept (maßgeblich für die Fachlogik).
- [`../main-server-infra`](../main-server-infra) — geteilte Postgres, nginx, TLS, Backups (live).
