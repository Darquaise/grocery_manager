# Grocery Manager – Projektplan

Eine private Web-App (PWA) zur Verwaltung von Küchen-Verbrauchsmaterialien für zwei Personen.
Aufrufbar über eine eigene URL, installierbar auf dem iPhone-Homescreen.

> Status (Stand 2026-06-20): Konzept abgestimmt (16.06.2026), Architektur überarbeitet
> (19.06.2026), **Phase 1 + 2 umgesetzt** (Stack: **Python/FastAPI · Angular · PostgreSQL**).
> Dieses Dokument ist die fachliche Spezifikation; den konkreten Umsetzungsstand führt
> [`README.md`](./README.md) (Tabelle „Umsetzungsstand der Anforderungen"). Offen: optionale
> Phase 3 + Deploy/CI.

---

## 1. Ziel & Rahmen

- **Zweck:** Überblick behalten, was an Verbrauchsmaterialien (Lebensmittel, Vorräte – **keine** Utensilien) zu Hause ist, was zur Neige geht und automatisch eine Einkaufsliste erzeugen.
- **Nutzer:** Genau 2 Personen (du + deine Freundin), eine geteilte Datenbasis.
- **Produkte sind generisch:** „Tomaten", nicht „Tomaten Marke X" → **kein Barcode-Scan**, stattdessen manuelle Eingabe mit Autovervollständigung aus der bestehenden Produktliste.
- **Sicherheit:** bewusst niedrig priorisiert (kleiner privater Nutzerkreis), aber ein einfacher Login schützt vor Fremdzugriff.
- **Plattform:** Mobile-first PWA, „Zum Home-Bildschirm hinzufügen" auf dem iPhone.

---

## 2. Kernfunktionen (abgestimmt)

| Bereich                     | Entscheidung                                                                                                                                                                                                           |
|-----------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Bestandsmodell**          | **Mix je Produkt** – jedes Produkt hat einen Typ: `Status` (Voll/Fast voll/Mittel/Knapp/Leer), `Zähler` (ganze Zahl) oder `Menge` (Wert + Einheit g/ml/Stück).                                                         |
| **Mindestmenge**            | Pro Produkt definierbar. Unterschreiten → Produkt landet **automatisch** auf der Einkaufsliste. Zusätzlich **manuelle** Einträge möglich.                                                                              |
| **Status-Schwelle**         | Bei `Status`-Produkten ist die Auto-Listen-Schwelle **pro Produkt** einstellbar (Standard: `Knapp`). Technisch = `minValue` als Ordinalwert; „Voll" ist als Schwelle nicht wählbar (läge sonst immer auf der Liste).   |
| **Verbrauchen**             | Produkt **öffnen → Bestand im Detail anpassen** (Status runter / Zähler −1 / Menge −Schritt). Bewusst gegen Versehen.                                                                                                  |
| **Mengen-Anpassung**        | Beim `Menge`-Typ: **Schnell-Buttons** (±Schrittgröße, pro Produkt definierbar) **plus** freie Eingabe des exakten Restwerts.                                                                                           |
| **Einkaufsliste**           | Aktive, geteilte Liste. Auto-Einträge zeigen **nur den Namen** (keine Menge). Manuelle Einträge dürfen eine Menge/Notiz tragen. **Freie Einträge** (Einmalkäufe ohne Bestandsführung, z. B. „Grillkohle") erlaubt.     |
| **Auto-Eintrag wegwischen** | Ein Auto-Eintrag lässt sich entfernen → **Snooze bis Wiederauffüllen**: kommt erst zurück, wenn das Produkt zwischenzeitlich über die Mindestmenge aufgefüllt wurde und erneut darunter fällt (`ignoredUntilRestock`). |
| **Im Laden abhaken**        | „Eingepackt = gekauft". **Resilient-online** (Optimistic UI + Retry bei wackeligem Netz). Haken erscheint v. a. dort, wo eine konkrete Menge angegeben ist (manuelle Einträge / Produkte mit hinterlegtem Wert).       |
| **Bestand nach Kauf**       | Beim Abschließen: Produkte mit optionalem **„Voll"-Wert** werden darauf gesetzt; `Status`-Produkte → „Voll"; ohne Wert nur als „gekauft" markiert (genaue Zahl pflegt man beim Ausräumen).                             |
| **Übersicht**               | Gruppiert **nach Kategorie**, zusätzlich **Filter nach Lagerort**, Suche, knappe Bestände hervorgehoben.                                                                                                               |
| **Kategorien**              | **Vorgegebene Standardkategorien + eigene ergänzbar.**                                                                                                                                                                 |
| **Lagerorte**               | **Verwaltete Liste wie Kategorien** (Standard-Set + eigene), in den Einstellungen sortierbar; am Produkt per Auswahl. Standard: Kühlschrank, Vorratsschrank, Tiefkühler.                                               |
| **Login**                   | **Zwei persönliche Accounts**, beim Deploy fest angelegt (Seed). Jeder Nutzer hat eine **Farbe**.                                                                                                                      |
| **Wer-hat-was**             | Kleine **farbige Markierung** (Punkt/Akzent, **kein Foto**) an passenden Stellen, z. B. neben manuell hinzugefügten Einkaufseinträgen.                                                                                 |
| **Einkauf abschließen**     | Einkauf als **Trip starten/beenden** → wird **archiviert**. Optional: **Gesamtpreis** anhängen.                                                                                                                        |
| **Optik**                   | Hell & clean, modern (Tailwind + eigene Komponenten); folgt automatisch dem iPhone Hell-/Dunkelmodus.                                                                                                                  |
| **Benachrichtigungen**      | „Nice to have": Web-Push für installierte PWA (iOS 16.4+). **Kein Must-have** – als optionale spätere Phase.                                                                                                           |

---

## 3. Datenmodell (Entwurf)

### User
- `id`, `name`, `color` (für Markierungen), `passwordHash` (argon2), `createdAt`

### Category
- `id`, `name`, `sortOrder`, `isDefault`
- Standard-Set z. B.: Gemüse, Obst, Milchprodukte, Brot/Backwaren, Vorrat/Trocken, Tiefkühl, Getränke, Hygiene/Haushalt, Sonstiges.

### Location (Lagerort)
- `id`, `name`, `sortOrder`, `isDefault` — **verwaltete Liste wie Kategorien** (CRUD + Sortierung in den Einstellungen).
- Standard-Set: Kühlschrank, Vorratsschrank, Tiefkühler.

### Product
- `id`, `name`, `categoryId`, `locationId` (optional, FK auf Lagerort)
- `trackingType`: `status` | `counter` | `amount`
- `currentValue` – Bedeutung je Typ:
  - `status`: Ordinalwert (leer=0, knapp=1, mittel=2, fast voll=3, voll=4)
  - `counter`: ganze Zahl
  - `amount`: Zahl + `unit` (z. B. g/ml/Stück)
- `minValue` – Mindestmenge / Schwelle für Auto-Einkaufsliste. Bei `status` = Ordinalwert (Standard 1 = „Knapp").
- `step` (optional) – Schrittgröße für ±Schnell-Buttons bei `counter`/`amount`.
- `fullValue` (optional „Voll"-Wert für schnelles Auffüllen nach Kauf)
- `unit` (nur bei `amount`)
- `notes` (optional)
- `updatedAt`, `updatedBy`
- `deletedAt` (optional – **Soft-Delete**: ausgeblendet, aber Archiv-/Listenbezüge bleiben intakt, reaktivierbar)
- `expiryDate` (Feld vorgesehen, **Funktion erst später** aktiv)

### ShoppingListItem (aktive Liste)
- `id`, `productId` (nullable bei freiem Eintrag), `displayName`
- `amountText` (optional; bei manuellen Einträgen)
- `source`: `auto` (aus Mindestmenge) | `manual`
- `addedBy` (User → Farbmarkierung), nur relevant bei `manual`
- `state`: `open` | `inCart`
- `ignoredUntilRestock` (bool – Snooze für weggewischte Auto-Einträge)

### ShoppingTrip (Archiv)
- `id`, `startedAt`, `completedAt`, `completedBy`
- `items` (Snapshot der gekauften Einträge, inkl. Namens-Snapshot für spätere Lesbarkeit)
- `totalPrice` (optional)

---

## 4. App-Struktur / Screens

Mobile-Layout mit Bottom-Navigation:

1. **Bestand (Übersicht)** – nach Kategorie gruppiert, Lagerort-Filter, Suche, knappe Bestände markiert.
2. **Produkt-Detail** – Bestand anpassen (= verbrauchen/auffüllen), Typ, Mindestmenge/Status-Schwelle, Schrittgröße, „Voll"-Wert, Kategorie, Lagerort, Notiz bearbeiten.
3. **Einkaufsliste** – aktive Liste; im Laden abhaken (resilient-online); manuell/frei hinzufügen mit Mengen-Option + Farbmarkierung; Auto-Einträge wegwischbar (Snooze); „Einkauf abschließen".
4. **Archiv** – vergangene Einkäufe mit optionalem Gesamtpreis.
5. **Einstellungen** – Kategorien **und Lagerorte** verwalten (einklappbar, per Drag sortierbar, ein Speichern-Knopf unter der Liste), Nutzer/Farben, Logout.

---

## 5. Technische Architektur

> Du bist Entwickler, übernimmst die Umsetzung aber aus Zeitgründen nicht selbst.
> Stack laut Vorgabe: **Python/FastAPI · Angular · PostgreSQL**, betrieben per Docker hinter deinem bestehenden Reverse Proxy.

- **Frontend:** **Angular** (aktuelle Version, Standalone Components + Signals) + TypeScript, **Tailwind CSS + eigene Komponenten** für den cleanen Look. Als **PWA** installierbar (Angular Service Worker / `@angular/pwa` für App-Shell- und Asset-Caching), folgt iOS Hell-/Dunkelmodus.
- **Backend:** **Python 3.14 + FastAPI** (uvicorn), Paketmanager **uv**. Liefert die **API und das gebaute Angular** aus (StaticFiles + SPA-Fallback) → **ein Origin, kein CORS**.
- **Datenbank:** **PostgreSQL**, **geteilte Server-Instanz** (projektübergreifend), dieses Projekt bekommt eine **eigene Datenbank `grocery`** + eigene Rolle `grocery_app` (Rechte nur auf diese DB). **SQLModel + Alembic** (Migrationen).
  - *Bilder/BLOBs werden nicht benötigt* (Bon-Foto verworfen) → kein `BYTEA`/Large-Object-Einsatz. Falls je nötig: `BYTEA` für kleine Dateien.
- **Auth:** 2 feste Accounts (Seed via ENV beim ersten Start, keine offene Registrierung), **argon2**-Passwort-Hash, **httpOnly Session-Cookie** (signiert). Bewusst schlicht.
- **Resilient-Online + Offline-Lesen (Details in §6):**
  - Server bleibt **Source of Truth**, der lokale Store ist reiner Wegwerf-Cache.
  - **Lesen überall offline** (IndexedDB-Cache, stale-while-revalidate), **Schreiben gepuffert** (Outbox) und später synchronisiert.
  - **Konflikte erkennen + nachfragen** (Optimistic Concurrency via `expected_updated_at` → 409); kein Voll-Sync-Motor.
- **Deployment:**
  - Docker Compose **dieses Projekts = nur der App-Container** (FastAPI + Angular-Build).
  - Anbindung an die geteilte Postgres-Instanz über ein **gemeinsames internes Docker-Netz** (z. B. `shared-db`).
  - Hinter deinem bestehenden **Reverse Proxy + TLS**, eigene Subdomain.
  - Footprint klein (uvicorn ~150–250 MB, Angular statisch ~0) – passt auf den 8-GB/4-Kerne-Server.
- **Backups:** `pg_dump` der `grocery`-DB per Cron + Offsite-Kopie.
- **Benachrichtigungen (optional, spätere Phase):** Web Push (VAPID) – funktioniert für **installierte** PWAs ab iOS 16.4; wird nur umgesetzt, wenn es sauber läuft.

---

## 6. Offline & Browser-Caching

> **Status: umgesetzt (2026-06-20)** — Frontend-Build + Backend-Tests grün; das reine
> Browser-Offline-Verhalten (DevTools/iOS-PWA) ist noch manuell zu prüfen. Konkrete
> Module/Stand: [`README.md`](./README.md), Abschnitt „Offline & Caching".
>
> Verfeinert die ursprüngliche „Resilient-Online"-Idee: **Lesen überall offline**,
> **Schreiben gepuffert** und später synchronisiert, **Konflikte erkennen + nachfragen**.
> Server bleibt Source of Truth; der lokale Store ist reiner Wegwerf-Cache.

**Offline nutzbar:** Einkaufsliste (lesen + abhaken + hinzufügen/entfernen), Bestand
ansehen, Bestand ändern (verbrauchen/auffüllen). **Nicht** offline: Verwaltung
(Produkte/Kategorien/Lagerorte anlegen/bearbeiten) und Archiv.

- **Lokaler Store = IndexedDB:** Cache je Datentyp (products/categories/locations/shopping, je + `fetchedAt`) **+ Outbox** (Mutations-Queue mit Op-Typ, Payload, zuletzt gesehenem `updatedAt`/Basiswert).
- **Lesen (stale-while-revalidate):** sofort Cache, Refresh im Hintergrund; Prefetch beim App-Start/Login; zusätzlich Refresh bei App-Fokus und Reconnect.
- **Einkaufsliste „quasi-live":** solange der Screen sichtbar + online ist, alle **5 s** pollen (gemeinsames Einkaufen → man sieht, was der/die andere schon eingepackt/gestrichen hat). Pausiert offline/im Hintergrund.
- **Schreiben (Outbox):** optimistisch in den Cache, dann Server; bei offline/Fehler in die Outbox. Op-Typen: `shopping.toggle/add/remove`, `product.adjust` (absoluter Zielwert + Basis-`updatedAt`). Offline angelegte Einkaufseinträge bekommen eine **temporäre ID** (beim Sync gegen die echte getauscht). Auto-Einkaufsliste wird **erst nach dem Sync** befüllt (keine Regel-Duplizierung im Client).
- **Sync-Auslöser:** App-Start · Reconnect (`online`) · App-Fokus (`visibilitychange`) · manueller Button (+ 5-s-Polling auf dem Einkaufs-Screen). iOS hat kein Background-Sync → bewusst Vordergrund-getrieben.
- **Konflikte (Optimistic Concurrency):** Client schickt beim Schreiben den zuletzt gesehenen `updatedAt`; weicht der Server-Stand ab → **409** + aktueller Wert. Gleiches Ergebnis → stilles Verwerfen. Echter Konflikt → Dialog „deine vs. ihre Version" pro Produkt. Backend bekommt dafür ein optionales `expected_updated_at` (abwärtskompatibel).
- **Auth offline:** letzter Nutzer lokal gecacht; `authGuard` lässt mit Cache durch und prüft `me` im Hintergrund — Logout nur bei echtem 401, nicht bei Netzfehler.
- **Status (dezent):** Offline-Icon in der Bottom-Nav; „ausstehend"-Marker an noch nicht gesyncten Einträgen; aktiv nur Konflikt-Dialog/Fehler-Toast. Online-Erkennung über Request-Erfolg/-Fehler (`navigator.onLine` nur als Auslöser).
- **Service Worker** bleibt für App-Shell/Assets + Auto-Update-Reload; `/api` wird bewusst app-seitig (IndexedDB) gecacht, nicht im SW.

**Umgesetzt in 3 Schritten:** (1) IndexedDB-Layer + cache-first/stale-while-revalidate
(Bestand/Liste offline lesbar) + authGuard-Fix + Offline-Icon; (2) Outbox für die
Einkaufsliste (abhaken/hinzufügen/entfernen, temp-IDs) + 5-s-Polling; (3) Bestand-Ändern
offline + Optimistic-Concurrency (Backend `expected_updated_at` → 409) + Konflikt-Dialog.

---

## 7. Umsetzungsphasen

> **Phase 1 (MVP online) und Phase 2 (laden-tauglich + Archiv) sind umgesetzt und
> verifiziert.** Den feinen Stand führt [`README.md`](./README.md) (Tabelle
> „Umsetzungsstand der Anforderungen"). Hier steht nur noch das, was offen ist.

**Offline-Ausbau (umgesetzt)** — Konzept + Stand siehe §6.

**Phase 3 – Optional / Stretch (offen)**
- Web-Push-Benachrichtigungen (z. B. „Produkt X ist leer"), VAPID, iOS 16.4+.
- Haltbarkeits-/MHD-Verwaltung (Feld `expiryDate` ist im Modell vorgesehen, noch ohne UI).

**Betrieb – offen**
- Deploy des App-Containers auf ep3o (Infra: DB, vhost, TLS stehen; Container noch nicht gestartet).
- Mehr automatisierte Tests (Frontend) + einfache CI.

---

## 8. Getroffene Annahmen (pragmatisch entschieden, korrigierbar)

- **Sprache:** nur Deutsch (keine i18n).
- **Einheiten** beim `Menge`-Typ: g, ml, Stück (erweiterbar).
- **Ein** aktiver, geteilter Einkaufs-Trip gleichzeitig.
- **Sortierung** innerhalb einer Kategorie: alphabetisch, knappe Bestände hervorgehoben.
- **Reihenfolge** von Kategorien/Lagerorten: manuell per Drag in den Einstellungen (`sortOrder`).
- **Farbauswahl** der 2 Nutzer in den Einstellungen.
- **Auth:** httpOnly-Session-Cookie + argon2; Accounts per Seed/ENV.
- **Tooling:** Python 3.14 + uv; Angular Standalone Components + Signals.
- **Reverse Proxy:** Host-nginx auf ep3o, Subdomain **shopping.darquaise.com** (entschieden).
- **Standard-Kategorien & -Lagerorte:** als Seed angelegt, in den Einstellungen editierbar (entschieden).
- **Farbmarkierungen:** neben manuellen Listeneinträgen, „zuletzt geändert von" im Produkt-Detail, „abgeschlossen von" im Archiv.