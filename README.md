# Grocery Manager

Private, mobile-first **PWA** für genau 2 Personen, um Küchen-Verbrauchsmaterialien
(Lebensmittel/Vorräte) zu verwalten und automatisch eine Einkaufsliste zu erzeugen.

- **Produktspezifikation / Konzept:** [`PLAN.md`](./PLAN.md) ← die fachliche Wahrheit.
- **Backend-Dev-Doku:** [`backend/README.md`](./backend/README.md).
- **Server-/Infrastruktur:** Schwester-Repo [`../main-server-infra`](../main-server-infra) (geteilte Postgres, nginx, TLS) — **bereits live** auf ep3o.

> **Stand: 2026-06-20** — Scaffold steht und ist **end-to-end verifiziert** (Build +
> Container-Smoke-Test grün). Die eigentliche **Fachlogik aus `PLAN.md` ist noch
> größtenteils offen** (siehe „Was noch zu tun ist").

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

**DB für lokal:** Tunnel auf die echte Postgres oder eine Wegwerf-DB:
```bash
ssh -L 5432:127.0.0.1:5432 ep3o          # dann DATABASE_URL=…@localhost:5432/grocery
# oder:
docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:18
```

**Starten (zwei Terminals, absolute Pfade!):**
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

- **Backend** lauffähig: config/db/models (alle 5 PLAN-Entitäten)/security/seed/4 API-Router,
  SPA-Mount mit SPA-Fallback. Geprüft: `uv` import + `ruff` + TestClient (alle 8 API-Pfade,
  Auth-Schutz greift).
- **Frontend** baut: App-Shell mit Bottom-Nav, `authGuard`, `AuthService`, Login + 4 Seiten,
  Tailwind + PWA (Service Worker, Manifest, iOS-Tags).
- **Dockerfile** baut das kombinierte Image (482 MB); Container serviert API + SPA + Deep-Links (200).
- **`compose.yml`** validiert; lokales `docker compose` ist eingerichtet (colima + Plugin).
- Auf ep3o: Postgres + `grocery`-DB + vhost + Platzhalter-Apex live (siehe infra-Repo).

Die API-Endpunkte sind **bewusst minimale Stubs** (list/create/login/…), nur das Gerüst.

---

## Was noch zu tun ist (priorisiert)

1. **Alembic-Initialmigration** erzeugen und zur Schema-Wahrheit machen
   (`uv run alembic revision --autogenerate -m "init"`), danach das `create_all()`
   in `main.py`s lifespan für Prod entschärfen/gaten (aktuell nur Dev-Komfort).
2. **Fachlogik aus `PLAN.md` umsetzen** — der eigentliche Kern:
   - **Produkte**: vollständiges CRUD, Soft-Delete, Lagerort, 3 Tracking-Typen,
     `min_value`/Status-Schwelle, `step` (±-Schnellbuttons), `full_value`.
   - **Auto-Einkaufsliste**: Unterschreiten von `min_value` → Auto-Eintrag; Lifecycle
     `ignored_until_restock` (Snooze bis Wiederauffüllen).
   - **Einkaufen**: Abhaken (`open`→`inCart`), **Trip abschließen → Archiv**,
     „Voll"-Wert-Logik anwenden, Farbmarkierungen.
   - **Resilient-Online**: Listen-Cache + Optimistic-Abhaken + Retry-Queue
     (bewusst **kein** voller Offline-Sync — siehe PLAN).
   - **Kategorien/Settings**: CRUD, Nutzer-Farben.
3. **Frontend-Screens ausbauen**: Produkt-Detail, Kategorie-Gruppierung, Lagerort-Filter,
   Suche, Knapp-Hervorhebung, Autovervollständigung aus der Produktliste, ±-Buttons.
4. **Tests** (backend `pytest`, frontend), evtl. simple CI.
5. **Phase 3 (optional)**: Web-Push, MHD/Haltbarkeit.

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
