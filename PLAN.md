# Grocery Manager – Projektplan

Eine private Web-App (PWA) zur Verwaltung von Küchen-Verbrauchsmaterialien für zwei Personen.
Aufrufbar über eine eigene URL, installierbar auf dem iPhone-Homescreen.

> Status: Konzept abgestimmt (16.06.2026), **technische Architektur überarbeitet (19.06.2026)**.
> Stack neu: **Python/FastAPI · Angular · PostgreSQL**. Nächster Schritt: Umsetzung Phase 1.

---

## 1. Ziel & Rahmen

- **Zweck:** Überblick behalten, was an Verbrauchsmaterialien (Lebensmittel, Vorräte – **keine** Utensilien) zu Hause ist, was zur Neige geht und automatisch eine Einkaufsliste erzeugen.
- **Nutzer:** Genau 2 Personen (du + deine Freundin), eine geteilte Datenbasis.
- **Produkte sind generisch:** „Tomaten", nicht „Tomaten Marke X" → **kein Barcode-Scan**, stattdessen manuelle Eingabe mit Autovervollständigung aus der bestehenden Produktliste.
- **Sicherheit:** bewusst niedrig priorisiert (kleiner privater Nutzerkreis), aber ein einfacher Login schützt vor Fremdzugriff.
- **Plattform:** Mobile-first PWA, „Zum Home-Bildschirm hinzufügen" auf dem iPhone.

---

## 2. Kernfunktionen (abgestimmt)

| Bereich                 | Entscheidung                                                                                                                                                                                                      |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Bestandsmodell**      | **Mix je Produkt** – jedes Produkt hat einen Typ: `Status` (Voll/Knapp/Leer), `Zähler` (ganze Zahl) oder `Menge` (Wert + Einheit g/ml/Stück).                                                                     |
| **Mindestmenge**        | Pro Produkt definierbar. Unterschreiten → Produkt landet **automatisch** auf der Einkaufsliste. Zusätzlich **manuelle** Einträge möglich.                                                                         |
| **Status-Schwelle**     | Bei `Status`-Produkten ist die Auto-Listen-Schwelle **pro Produkt** einstellbar (Standard: `Knapp`). Technisch = `minValue` als Ordinalwert.                                                                       |
| **Verbrauchen**         | Produkt **öffnen → Bestand im Detail anpassen** (Status runter / Zähler −1 / Menge −Schritt). Bewusst gegen Versehen.                                                                                             |
| **Mengen-Anpassung**    | Beim `Menge`-Typ: **Schnell-Buttons** (±Schrittgröße, pro Produkt definierbar) **plus** freie Eingabe des exakten Restwerts.                                                                                      |
| **Einkaufsliste**       | Aktive, geteilte Liste. Auto-Einträge zeigen **nur den Namen** (keine Menge). Manuelle Einträge dürfen eine Menge/Notiz tragen. **Freie Einträge** (Einmalkäufe ohne Bestandsführung, z. B. „Grillkohle") erlaubt. |
| **Auto-Eintrag wegwischen** | Ein Auto-Eintrag lässt sich entfernen → **Snooze bis Wiederauffüllen**: kommt erst zurück, wenn das Produkt zwischenzeitlich über die Mindestmenge aufgefüllt wurde und erneut darunter fällt (`ignoredUntilRestock`). |
| **Im Laden abhaken**    | „Eingepackt = gekauft". **Resilient-online** (Optimistic UI + Retry bei wackeligem Netz). Haken erscheint v. a. dort, wo eine konkrete Menge angegeben ist (manuelle Einträge / Produkte mit hinterlegtem Wert).  |
| **Bestand nach Kauf**   | Beim Abschließen: Produkte mit optionalem **„Voll"-Wert** werden darauf gesetzt; `Status`-Produkte → „Voll"; ohne Wert nur als „gekauft" markiert (genaue Zahl pflegt man beim Ausräumen).                        |
| **Übersicht**           | Gruppiert **nach Kategorie**, zusätzlich **Filter nach Lagerort**, Suche, knappe Bestände hervorgehoben.                                                                                                          |
| **Kategorien**          | **Vorgegebene Standardkategorien + eigene ergänzbar.**                                                                                                                                                            |
| **Login**               | **Zwei persönliche Accounts**, beim Deploy fest angelegt (Seed). Jeder Nutzer hat eine **Farbe**.                                                                                                                 |
| **Wer-hat-was**         | Kleine **farbige Markierung** (Punkt/Akzent, **kein Foto**) an passenden Stellen, z. B. neben manuell hinzugefügten Einkaufseinträgen.                                                                            |
| **Einkauf abschließen** | Einkauf als **Trip starten/beenden** → wird **archiviert**. Optional: **Gesamtpreis** anhängen.                                                                             |
| **Optik**               | Hell & clean, modern (Tailwind + eigene Komponenten); folgt automatisch dem iPhone Hell-/Dunkelmodus.                                                                                                             |
| **Benachrichtigungen**  | „Nice to have": Web-Push für installierte PWA (iOS 16.4+). **Kein Must-have** – als optionale spätere Phase.                                                                                                      |

---

## 3. Datenmodell (Entwurf)

### User
- `id`, `name`, `color` (für Markierungen), `passwordHash` (argon2), `createdAt`

### Category
- `id`, `name`, `sortOrder`, `isDefault`
- Standard-Set z. B.: Gemüse, Obst, Milchprodukte, Brot/Backwaren, Vorrat/Trocken, Tiefkühl, Getränke, Hygiene/Haushalt, Sonstiges.

### Product
- `id`, `name`, `categoryId`, `location` (optional, z. B. Kühlschrank/Vorratsschrank/Tiefkühler)
- `trackingType`: `status` | `counter` | `amount`
- `currentValue` – Bedeutung je Typ:
  - `status`: Ordinalwert (leer=0, knapp=1, voll=2)
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
5. **Einstellungen** – Kategorien verwalten, Nutzer/Farben, Logout.

---

## 5. Technische Architektur

> Du bist Entwickler, übernimmst die Umsetzung aber aus Zeitgründen nicht selbst.
> Stack laut Vorgabe: **Python/FastAPI · Angular · PostgreSQL**, betrieben per Docker hinter deinem bestehenden Reverse Proxy.

- **Frontend:** **Angular** (aktuelle Version, Standalone Components + Signals) + TypeScript, **Tailwind CSS + eigene Komponenten** für den cleanen Look. Als **PWA** installierbar (Angular Service Worker / `@angular/pwa` für App-Shell- und Asset-Caching), folgt iOS Hell-/Dunkelmodus.
- **Backend:** **Python 3.14 + FastAPI** (uvicorn), Paketmanager **uv**. Liefert die **API und das gebaute Angular** aus (StaticFiles + SPA-Fallback) → **ein Origin, kein CORS**.
- **Datenbank:** **PostgreSQL**, **geteilte Server-Instanz** (projektübergreifend), dieses Projekt bekommt eine **eigene Datenbank `grocery`** + eigene Rolle `grocery_app` (Rechte nur auf diese DB). **SQLModel + Alembic** (Migrationen).
  - *Bilder/BLOBs werden nicht benötigt* (Bon-Foto verworfen) → kein `BYTEA`/Large-Object-Einsatz. Falls je nötig: `BYTEA` für kleine Dateien.
- **Auth:** 2 feste Accounts (Seed via ENV beim ersten Start, keine offene Registrierung), **argon2**-Passwort-Hash, **httpOnly Session-Cookie** (signiert). Bewusst schlicht.
- **Resilient-Online (statt Voll-Offline):**
  - Server ist **Source of Truth**.
  - Einkaufsliste wird clientseitig **gecached** (IndexedDB/localStorage) für schnelles Lesen.
  - Abhaken/Mutationen mit **Optimistic UI** + **Retry bei Reconnect** (kleine Queue speziell fürs Abhaken).
  - **Kein** vollständiger Sync-/Konflikt-Motor; bei 2 Nutzern reicht serverseitiges Last-Write-Wins auf API-Ebene.
- **Deployment:**
  - Docker Compose **dieses Projekts = nur der App-Container** (FastAPI + Angular-Build).
  - Anbindung an die geteilte Postgres-Instanz über ein **gemeinsames internes Docker-Netz** (z. B. `shared-db`).
  - Hinter deinem bestehenden **Reverse Proxy + TLS**, eigene Subdomain.
  - Footprint klein (uvicorn ~150–250 MB, Angular statisch ~0) – passt auf den 8-GB/4-Kerne-Server.
- **Backups:** `pg_dump` der `grocery`-DB per Cron + Offsite-Kopie.
- **Benachrichtigungen (optional, spätere Phase):** Web Push (VAPID) – funktioniert für **installierte** PWAs ab iOS 16.4; wird nur umgesetzt, wenn es sauber läuft.

---

## 6. Umsetzungsphasen

**Phase 1 – MVP (online)**
- Login (2 feste Accounts, Farben), Grundgerüst PWA + installierbar.
- Produkte CRUD mit allen 3 Typen (inkl. `minValue`/Status-Schwelle, `step`, `fullValue`); Kategorien (Standard + eigene); Lagerort.
- Übersicht (Kategorie-Gruppierung, Lagerort-Filter, Suche, Knapp-Markierung).
- Verbrauchen/Auffüllen im Produkt-Detail (Schnell-Buttons + freie Eingabe).
- Mindestmengen → Auto-Einkaufsliste; manuelle + freie Einträge mit Farbmarkierung.
- Abhaken in der Liste (Optimistic UI); Auto-Einträge wegwischbar mit Snooze (`ignoredUntilRestock`).

**Phase 2 – Laden-tauglich & Archiv**
- Resilient-Online-Feinschliff: Listen-Cache + Retry-Queue fürs Abhaken bei wackeligem Netz.
- Einkauf abschließen → Trip-Archiv, optional Gesamtpreis.
- „Voll"-Wert-Logik beim Abschließen sauber anwenden.

**Phase 3 – Optional / Stretch**
- Web-Push-Benachrichtigungen (z. B. „Produkt X ist leer").
- Haltbarkeits-/MHD-Verwaltung (Feld bereits vorgesehen).
- Voll-Offline (IndexedDB-Mutations-Queue + Sync), falls sich Resilient-Online im Alltag als zu wenig erweist.

---

## 7. Offene Punkte & Annahmen

**Noch zu klären:**
- **Reverse-Proxy-Software** (nginx/Traefik/Caddy): entscheidet, ob die `docker-compose.yml` z. B. Traefik-Labels trägt oder der Proxy extern konfiguriert wird; der App-Container exponiert nur einen Port. *(Subdomain steht: **shopping.darquaise.com** → FastAPI-Container.)*
- **Standard-Kategorienliste** final festlegen (Vorschlag steht, jederzeit editierbar).

**Getroffene Annahmen (pragmatisch entschieden, korrigierbar):**
- **Sprache:** nur Deutsch (keine i18n).
- **Einheiten** beim `Menge`-Typ: g, ml, Stück (erweiterbar).
- **Ein** aktiver, geteilter Einkaufs-Trip gleichzeitig.
- **Sortierung** innerhalb einer Kategorie: alphabetisch, knappe Bestände hervorgehoben (keine Umsortierung).
- **Farbauswahl** der 2 Nutzer in den Einstellungen.
- **Auth:** httpOnly-Session-Cookie + argon2; Accounts per Seed/ENV.
- **Tooling:** Python 3.14 (aktuelle Stable) + uv; Angular Standalone Components + Signals.
- **Farbmarkierungen:** Platzierung nach Umsetzungs-Ermessen. Default: neben manuellen Listeneinträgen, „zuletzt geändert von" im Produkt-Detail, „abgeschlossen von" im Archiv.