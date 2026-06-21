# Grocery Manager

Private, mobile-first **PWA** für genau 2 Personen, um Küchen-Verbrauchsmaterialien
(Lebensmittel/Vorräte) zu verwalten und automatisch eine Einkaufsliste zu erzeugen.

- **Produktspezifikation / Konzept:** [`PLAN.md`](./PLAN.md) ← die fachliche Wahrheit.
- **Backend-Dev-Doku:** [`backend/README.md`](./backend/README.md).
- **Server-/Infrastruktur:** Schwester-Repo [`../main-server-infra`](../main-server-infra) (geteilte Postgres, nginx, TLS) — **bereits live** auf ep3o.

> **Stand: 2026-06-20** — **Phase 1 + 2 aus `PLAN.md` umgesetzt** und end-to-end
> verifiziert (Backend-`pytest` 27 grün, Angular-Prod-Build grün, Docker-Container-
> Smoke-Test grün inkl. Login → Auto-Einkaufsliste → Trip-Abschluss → Archiv).
> Dazu eine **Mobile-/PWA-Ausbaurunde**: Lagerorte als verwaltete Liste (wie Kategorien),
> überarbeitete Einstellungen (einklappbar, Drag-Sortierung, ein Speichern-Knopf),
> iPhone-taugliche Bottom-Nav und **automatischer Update-Reload** des Service Workers.
> Alembic ist jetzt auch **lokal** das Schema-Werkzeug (kein `create_all` mehr im Dev-Stack).
> Außerdem **Offline-Ausbau umgesetzt**: Offline-Lesen (IndexedDB, cache-first) + gepufferte
> Writes (Outbox) + 5-s-Live-Einkaufsliste + offline-toleranter Login + Konflikt-Dialog.
> Offen bleibt nur noch die **optionale Phase 3** (Web-Push, MHD) und mehr Tests/CI.
> Den feinen Umsetzungsstand führt die Tabelle ganz unten.

---

## Tech-Stack

| Schicht      | Wahl                                                                                                           |
|--------------|----------------------------------------------------------------------------------------------------------------|
| Backend      | **Python 3.14 · FastAPI · SQLModel · Alembic** (Paketmanager **uv**)                                           |
| Auth         | argon2-Hash, httpOnly **Session-Cookie** (Starlette `SessionMiddleware`)                                       |
| Frontend     | **Angular 20** (standalone + signals) · **Tailwind v4** · **PWA** (Service Worker)                             |
| DB           | **PostgreSQL** (geteilte Instanz auf ep3o, DB `grocery`)                                                       |
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
│  ├─ alembic.ini · migrations/versions/  # Alembic: init + managed_locations
│  └─ app/
│     ├─ main.py           # FastAPI-App, SPA-Mount + SPA-Fallback, lifespan(seed; create_all nur Dev-Notnagel)
│     ├─ config.py         # pydantic-settings (DATABASE_URL, SESSION_SECRET, USER1/2_*)
│     ├─ db.py · models.py · security.py · seed.py · shopping_logic.py
│     └─ api/{auth,users,categories,locations,products,shopping}.py
└─ frontend/               # Angular-Workspace (ng new)
   ├─ proxy.conf.json      # ng serve: /api → http://localhost:8000
   └─ src/app/
      ├─ app.{ts,html}     # Shell mit Bottom-Nav (Bestand/Einkauf/Archiv/Mehr) + SwUpdate-Auto-Reload
      ├─ app.routes.ts · app.config.ts
      ├─ services/          # auth, users, categories, locations, products, shopping,
      │                     #   offline-db (IndexedDB), connectivity, sync (Outbox/Konflikte)
      ├─ interceptors/connectivity-interceptor.ts  # Online-Erkennung über Request-Erfolg
      ├─ components/{editable-list,conflict-dialog}.ts
      ├─ guards/auth-guard.ts
      └─ pages/{login,inventory,product-detail,shopping,archive,settings}/
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
die lokale DB und fährt **`alembic upgrade head`** (wie Produktiv, `DB_AUTO_CREATE=false`)
→ Schema-Änderungen kommen **inkrementell, ohne Reset** an. Workflow bei Modell-
Änderungen: `cd backend && uv run alembic revision --autogenerate -m "…"`, die erzeugte
Datei prüfen, dann `dev-restart.sh` (oder direkt `uv run alembic upgrade head`).
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

## Qualitäts-Check (vor jedem Commit)

```bash
cd backend  && uv run ruff check . && uv run pytest -q   # Lint + 27 Tests
cd frontend && npm run lint && npm run build             # ESLint (angular-eslint) + Prod-Build
```

**Zusätzlich am Ende: IDE-Inspektion prüfen** (Warnungen/Hinweise, die `ruff`/ESLint/Build
nicht zwingend melden). In IntelliJ IDEA `Analyze → Inspect Code…` mit Scope **„Whole
project"** laufen lassen (deckt Backend-Python **und** Frontend-TypeScript ab) und das
Ergebnis im „Inspection Results"-Fenster **als XML nach `/.inspections/`** (gitignored)
exportieren — den Ordner vorher leeren, damit kein alter Stand mitgelesen wird. Findings
einzeln durchgehen und echte Probleme beheben; bekannte False-Positives (z. B.
IntelliJ/SQLModel-Inspektionen wie `Column.is_(None)`, `session.get(...)`-Returntyp
`type[Product]`) bewusst stehen lassen. Rauschen ist im IntelliJ-Modul bereits per
`excludeFolder` ausgeblendet: `node_modules`, `dist`, `.angular`, `.venv` und die
autogenerierten `migrations/versions`. Voraussetzung: das Modul ist als **Python-Modul**
mit Python-Interpreter als SDK angelegt (sonst verlangt „Inspect Code" eine JDK).

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
  - **Kategorien & Lagerorte**: je CRUD mit `sort_order` (Delete setzt das jeweilige
    Feld am Produkt auf `null`). Lagerorte sind jetzt eine **verwaltete Entität** (vorher
    Freitext am Produkt). **Users**: Liste + eigene Farbe. Geprüft: `ruff` +
    **`pytest` (27 Tests grün)**.
- **Alembic** ist die Schema-Wahrheit (`init` + `managed_locations`, inkl. Daten-Migration
  alter Freitext-Lagerorte). **Container und lokaler Dev-Stack** fahren beim Start
  `alembic upgrade head` (`DB_AUTO_CREATE=false`); `create_all` bleibt nur Notnagel/Default
  für schnelle Wegwerf-DBs (z. B. Tests).
- **Frontend** (Angular-Prod-Build grün): App-Shell + **Bottom-Nav** (höher, iPhone-
  Safe-Area, aktiver Bereich per Akzentbalken markiert), `authGuard`, Login,
  **Bestand** (Kategorie-Gruppierung, Lagerort-Filter, Suche, Knapp-Markierung),
  **Produkt-Detail** (anlegen/bearbeiten/±-Buttons/„Voll"/Soft-Delete, Kategorie- und
  Lagerort-Dropdown), **Einkaufsliste** (Optimistic-Abhaken + Retry-Queue +
  localStorage-Cache, Autovervollständigung, Farbmarkierung, Trip-Abschluss), **Archiv**,
  **Einstellungen** (einklappbare, per Drag (`@angular/cdk`) sortierbare Verwaltungslisten
  für **Kategorien & Lagerorte** mit einem Speichern-Knopf, Nutzerfarben, Logout). PWA:
  Service Worker + **automatischer Update-Reload** via `SwUpdate`, Manifest + Icons.
- **Offline & Caching**: IndexedDB-Cache (cache-first / stale-while-revalidate) für Bestand
  + Einkaufsliste, **Outbox** für Offline-Writes (Abhaken/Hinzufügen/Entfernen + Bestand
  ändern) mit Sync bei Start/Reconnect/Fokus/manuell, **5-s-Polling** der Einkaufsliste,
  offline-toleranter `authGuard`, **Konflikt-Dialog** (Optimistic Concurrency, 409). Offline-
  Icon + „ausstehend"-Marker. Frontend-Build grün; Browser-Offline-Verhalten manuell zu testen.
- **Docker**: kombiniertes Image baut; Container-Smoke-Test grün — SPA + Deep-Links
  + ganzer API-Fluss (Login → Auto-Liste → Trip → Archiv) gegen SQLite verifiziert.
- Auf ep3o: Postgres + `grocery`-DB + vhost + Platzhalter-Apex live (siehe infra-Repo).

---

## Offline & Caching (umgesetzt)

Verfeinert „Resilient-Online" zu **Lesen überall offline + gepufferte Writes**; volle
Spezifikation in [`PLAN.md`](./PLAN.md) §6. Kurzfassung:

- **Offline lesbar:** Einkaufsliste, Bestand. **Offline schreibbar:** Abhaken/Hinzufügen/
  Entfernen (Liste) + Bestand ändern (Outbox, später synchronisiert). **Nicht** offline:
  Verwaltung + Archiv.
- **IndexedDB** als lokaler Store (Cache je Datentyp + Outbox mit Basis-`updated_at`),
  **stale-while-revalidate**, Prefetch bei Login, Refresh bei App-Fokus/Reconnect.
- **Einkaufsliste pollt alle 5 s** (online + Screen sichtbar) → quasi-live beim gemeinsamen Einkaufen.
- **Konflikte:** Optimistic Concurrency (`expected_updated_at` → 409); gleicher Endwert =
  stilles Verwerfen, echter Konflikt = Dialog „deine vs. ihre". Kleine Backend-Ergänzung.
- **Auth offline:** `authGuard` lässt mit gecachtem Nutzer durch und prüft `me` im Hintergrund.
- **Status dezent:** Offline-Icon in der Nav + „ausstehend"-Marker; aktiv nur Konflikt/Fehler.

**Stand:** umgesetzt. Neue Bausteine: `services/offline-db` (IndexedDB-Cache + Outbox),
`services/connectivity` + `interceptors/connectivity-interceptor` (Online-Erkennung über
Request-Erfolg), `services/sync` (Outbox-Replay, Konflikte, Trigger), `components/conflict-dialog`.
Lese-Services laden cache-first; `authGuard` ist offline-tolerant; Backend-`adjust` macht
Optimistic Concurrency (`expected_updated_at` → 409, Test vorhanden). Der Service Worker cached
weiterhin nur App-Shell/Assets — `/api` läuft über IndexedDB. **Noch offen:** Browser-Offline
manuell prüfen (DevTools „Offline" / installierte iOS-PWA).

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

- **Funktional vollständiger MVP+ (Phase 1 + 2).** Bestand, Produkt-Detail, Auto-
  Einkaufsliste inkl. Snooze, Trip/Archiv und die Verwaltung (Kategorien/Lagerorte/
  Farben) sind end-to-end umgesetzt und getestet. Größter offener Brocken: **Deploy des
  Containers auf ep3o** + mehr automatisierte Tests/CI.
- **Alembic überall:** Schema-Änderungen laufen jetzt lokal **und** in Prod über
  `alembic upgrade head` (Dev-Stack inklusive). Modelländerung ⇒ **immer** eine Migration
  erzeugen (`alembic revision --autogenerate`) und prüfen; `create_all` ist nur noch
  Notnagel und sollte nicht als Schema-Wahrheit dienen.
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

---

## Umsetzungsstand der Anforderungen

Legende: ✅ umgesetzt · 🟡 teilweise/vorbereitet · ⬜️ offen.

| Anforderung (aus `PLAN.md` + Nacharbeiten)                                         | Status | Detailgrad / Anmerkung                                                                                      |
|------------------------------------------------------------------------------------|--------|-------------------------------------------------------------------------------------------------------------|
| Bestandsmodell mit 3 Typen (`status`/`counter`/`amount`)                           | ✅      | Backend + UI, alle Typen inkl. Einheit                                                                      |
| Mindestmenge / Status-Schwelle pro Produkt                                         | ✅      | `min_value`, Status als Ordinalwert                                                                         |
| Verbrauchen/Auffüllen im Detail (Schnell-Buttons + exakter Wert)                   | ✅      | inkl. „Voll auffüllen"                                                                                      |
| Auto-Einkaufsliste + Snooze bis Wiederauffüllen                                    | ✅      | `shopping_logic.py`, `ignored_until_restock`                                                                |
| Manuelle + freie Einträge (Menge/Notiz, Farbmarkierung)                            | ✅      | Autovervollständigung vorhanden                                                                             |
| Im Laden abhaken (Optimistic UI + Retry)                                           | ✅      | resilient-online, localStorage-Cache                                                                        |
| „Voll"-Wert-Logik beim Kauf-Abschluss                                              | ✅      | Status→Voll, optionaler Voll-Wert                                                                           |
| Übersicht: Kategorie-Gruppierung, Lagerort-Filter, Suche, Knapp-Markierung         | ✅      | —                                                                                                           |
| Kategorien (Standard + eigene) verwalten                                           | ✅      | CRUD + Drag-Sortierung in Einstellungen                                                                     |
| **Lagerorte verwalten (wie Kategorien)**                                           | ✅      | **neu:** eigene Entität + CRUD + Sortierung, Produkt-Dropdown                                               |
| Login (2 Seed-Accounts, Farben)                                                    | ✅      | argon2, httpOnly-Session-Cookie                                                                             |
| Wer-hat-was Farbmarkierung                                                         | 🟡     | an Listeneinträgen/Detail; Platzierung pragmatisch                                                          |
| Einkauf abschließen → Archiv (+ optional Gesamtpreis)                              | ✅      | Trip-Snapshot                                                                                               |
| Optik hell/clean, folgt iOS Dark/Light                                             | ✅      | Tailwind v4, `color-scheme`                                                                                 |
| **Einstellungen aufgeräumt** (einklappbar, Drag-Sortierung, Speichern unter Liste) | ✅      | **neu:** wiederverwendbare `editable-list`-Komponente                                                       |
| **Bottom-Nav** höher/iPhone-Safe-Area, aktiver Bereich erkennbar, Zahnrad-Icon     | ✅      | **neu:** Akzentbalken + Heroicons-Cog                                                                       |
| **PWA-Update-Check / Reload bei neuer Version**                                    | ✅      | **neu:** `SwUpdate`, Auto-Reload + Re-Check bei App-Fokus                                                   |
| **Alembic auch lokal** (Schemaänderung ohne DB-Reset)                              | ✅      | **neu:** Dev-Stack fährt `alembic upgrade head`                                                             |
| MHD / Haltbarkeit                                                                  | 🟡     | Feld `expiry_date` im Modell, noch ohne UI (Phase 3)                                                        |
| Web-Push-Benachrichtigungen                                                        | ⬜️     | Phase 3 (VAPID, iOS 16.4+)                                                                                  |
| Offline: Lesen überall + gepufferte Writes + Konflikt-Dialog                       | ✅      | IndexedDB-Cache, Outbox, 5-s-Polling, authGuard-Fix, 409-Konflikt-Dialog; Browser-Offline manuell zu testen |
| Tests / CI                                                                         | 🟡     | Backend: 27 `pytest` grün; Frontend-Tests + CI offen                                                        |
