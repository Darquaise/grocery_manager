# Browser-E2E-Testplan — Grocery Manager

Arbeitsdokument für einen automatisierten Browser-Testlauf (Claude mit
Chrome-Extension o. ä.). **Auftrag an das Test-Modell: ausschließlich testen,
beobachten und Befunde dokumentieren — NICHTS fixen, keine Code-Änderungen,
keine Commits.** Die Befunde werden später separat abgearbeitet.

---

## 1. Setup & Regeln

### 1.1 Stack starten

```bash
./scripts/dev-start.sh      # startet colima/DB/Backend/Frontend, wartet auf Health
```
- App: http://localhost:4200 · API: http://localhost:8000/api
- Logs: `.dev/backend.log` (uvicorn-Access-Log = jede API-Anfrage), `.dev/frontend.log`
- Dev-DB (Postgres in Docker): `postgresql+psycopg://grocery_app:grocery@localhost:5432/grocery`

### 1.2 Absolute Regeln

1. **Echte Daten nie anfassen:** Küche 1 („Küche“) und die Accounts `Kofi`/`JP`
   sind reale Daten. Nicht beitreten, nichts ändern, nicht löschen.
2. Test-Accounts heißen immer `e2e-…` (z. B. `e2e-anna`, Passwort-Schema
   `e2e-<name>-pw`). Test-Küchen heißen `E2E-…`. Test-Codes beginnen mit `e2e-`.
3. Registrierung ist invite-only. Test-Codes **direkt in die DB legen** (nicht
   über echte Accounts erzeugen):
   ```bash
   cd backend && DATABASE_URL="postgresql+psycopg://grocery_app:grocery@localhost:5432/grocery" \
   uv run python -c "
   from sqlalchemy import create_engine, text; import os
   eng = create_engine(os.environ['DATABASE_URL'])
   with eng.begin() as c:
       creator = c.execute(text('SELECT id FROM \"user\" ORDER BY id LIMIT 1')).scalar()
       c.execute(text(\"INSERT INTO accountinvite (code, created_by, created_at) VALUES ('e2e-code-1', :b, now())\"), {'b': creator})
   "
   ```
4. **Cleanup am Ende jedes Laufs:** Test-Küchen im UI als Owner löschen (räumt
   kaskadiert auf), danach Test-Accounts + Codes per SQL entfernen:
   ```sql
   DELETE FROM kitcheninvite WHERE user_id IN (SELECT id FROM "user" WHERE name LIKE 'e2e-%');
   DELETE FROM accountinvite WHERE code LIKE 'e2e-%' OR created_by IN (SELECT id FROM "user" WHERE name LIKE 'e2e-%') OR used_by IN (SELECT id FROM "user" WHERE name LIKE 'e2e-%');
   DELETE FROM kitchenmember WHERE user_id IN (SELECT id FROM "user" WHERE name LIKE 'e2e-%');
   DELETE FROM "user" WHERE name LIKE 'e2e-%';
   -- Kontrolle: SELECT name FROM "user"; SELECT id, name FROM kitchen;  → nur Kofi/JP + Küche 1
   ```
5. Browser-Tab am Ende abmelden.

### 1.3 Stolperfallen der Browser-Automatisierung

- **Native `confirm()`-Dialoge blockieren die Extension** (Produkt löschen,
  Mitglied entfernen, Transfer, Küche löschen/verlassen). Vor solchen Klicks im
  Seitenkontext ausführen: `window.confirm = () => true;` (gilt bis zur
  nächsten Navigation).
- Klicks direkt nach Navigation können verpuffen (Handler noch nicht gebunden).
  **Nach jedem schreibenden Klick den Effekt verifizieren** — sonst entstehen
  falsche Befunde: Screenshot (UI-Reaktion) + `read_network_requests`
  (Request abgesetzt? Status?). Kein Request + keine UI-Reaktion ⇒ Klick
  wiederholen, erst bei reproduzierbarem Ausbleiben als Befund werten.
- Eingabefelder vor dem Tippen anklicken; in der editierbaren Liste setzt
  Enter den Fokus erst nach ~1 s auf die neue Zeile (kurz warten).
- `input[type=color]` öffnet einen nativen Picker → nicht klicken; Wert per
  `form_input`/JS setzen oder Farbtest überspringen und notieren.
- **Server-Wahrheit gegenprüfen:** UI und DB können stillschweigend
  auseinanderlaufen (z. B. wenn eine Aktion serverseitig ein anderes Objekt
  trifft, als die UI zeigt) — sichtbar wird das nur im Vergleich. Nach
  Bestands-/Listen-Aktionen lohnt ein SQL-Blick:
  ```sql
  SELECT id, status_level, remaining, size, expiry_date, current_since FROM stockitem WHERE product_id = <id>;
  SELECT id, display_name, source, state, ignored_until_restock FROM shoppinglistitem WHERE kitchen_id = <kid>;
  ```

### 1.4 Befund-Format (Report)

Pro Problem ein Eintrag, keine Fixes vorschlagen müssen:

```
### B<lfd. Nr.> · <Bereich> · Schwere: kritisch | mittel | gering | kosmetisch
Schritte: 1. … 2. … (minimal, reproduzierbar; verwendeter Account/Küche)
Erwartet: …
Beobachtet: … (Screenshot-ID, ggf. Netzwerk-Status / SQL-Ergebnis / Konsolen-Fehler)
Reproduzierbar: ja/nein (wie oft probiert)
```

---

## 2. Umgebung & Fehlermuster

Die API-Logik ist durch die pytest-Suite abgedeckt (`backend/tests`) — die
UI-Tests prüfen primär, ob die Oberfläche die API korrekt anspricht und
darstellt.

### 2.1 Nicht in dieser Umgebung testbar

- **Offline** (Outbox-Anzeige, Konflikt-Dialog, „ausstehend“-Marker): Die
  Extension kann den Browser nicht offline schalten. → manuell/iPhone.
- **PWA/Service-Worker-Update:** im Dev-Modus deaktiviert. → installierter Build.
- **Echtes Zwei-Geräte-Verhalten** (SSE-Live-Updates gleichzeitig): nur ein Tab
  steuerbar. Ersatzweise: Änderungen per **API** (curl mit zweitem
  Session-Cookie) einspielen — sie erscheinen binnen ~1–2 s per SSE auf jeder
  Seite. Achtung: direkt per SQL eingespielte Änderungen erzeugen **kein**
  SSE-Event (die Middleware sieht nur API-Mutationen); sie erscheinen erst
  nach App-Fokus/Reload.

### 2.2 Fehlermuster, auf die besonders zu achten ist

- (a) **Falsches Zielpaket:** Status-/±-Buttons wirken immer auf `stock[0]`;
  welches Paket „aktuell“ ist, bestimmt `current_since` (Server:
  `ensure_current`). Nach „Paket hinzufügen + sofort ändern“ muss die Änderung
  das OFFENE Paket treffen → EC-H1, immer per DB verifizieren.
- (b) **Signal-Effects, die Signale tracken, die ihre eigene Arbeit schreibt**
  → Endlosschleife/Request-Sturm. → EC-B3 und §3.M-Ruhebeobachtung.
- (c) **Cache-/localStorage-Reste nach Account-Wechsel im selben Browser**
  → EC-A8.

---

## 3. Detaillierte Testflows

Vorbereitung für alle Flows: zwei Codes in die DB legen, `e2e-anna`
registrieren, Küche „E2E-Küche“ erstellen. Wo ein zweiter Account nötig ist:
`e2e-ben`. Jeder Flow nennt zusätzlich seine Edge-Cases (EC) — jede EC ist ein
eigener kleiner Test mit Erwartungshaltung.

### A. Auth & Registrierung

Flow: Login-Seite → „Neu hier?“ → Name/Passwort/Code → Account erstellen →
landet auf `/setup`. Abmelden → normales Login mit denselben Daten.

- EC-A1: falscher Code → deutsche Fehlermeldung, kein Account (SQL: `SELECT * FROM "user" WHERE name='…'` leer)
- EC-A2: bereits benutzter Code erneut → Fehlermeldung „ungültig/benutzt“
- EC-A3: existierender Name (`e2e-anna` nochmal) → „Name vergeben“-Meldung
- EC-A4: Name nur aus Leerzeichen / leeres Passwort → Fehler, kein 500
- EC-A5: Name mit führenden/abschließenden Leerzeichen `" e2e-x "` → wird getrimmt gespeichert?
- EC-A6: falsches Passwort beim Login → Fehlermeldung, kein Redirect
- EC-A7: eingeloggt `/login` direkt aufrufen → Redirect auf `/` (`guestGuard`); abgemeldet bleibt `/login` erreichbar
- EC-A8: nach Login eines ANDEREN Accounts im selben Browser: Einkauf-Badge und
  Bestand dürfen keine Reste des vorherigen Accounts zeigen (Muster §2.2c)

### B. Setup / Onboarding (Account ohne Küche)

Flow: frischer Account → `/setup`. Küche erstellen → Bestand. Alternativ:
„Ich wurde hinzugefügt — aktualisieren“ nachdem per SQL/Zweitaccount eine
Einladung angelegt wurde → Beitritts-Dialog erscheint.

- EC-B1: leerer/Leerzeichen-Küchenname → kein Anlegen, Fehlermeldung
- EC-B2: direkter Aufruf von `/`, `/shopping`, `/settings` ohne Küche → muss auf `/setup` umleiten
- EC-B3: ~30 s auf `/setup` warten → **Netzwerk beobachten: keine Request-Schleife**, Heap stabil (Muster §2.2b; `performance.memory` einmal zu Beginn/Ende)
- EC-B4: Einladung eintreffen lassen, ablehnen → Dialog schließt, Setup bleibt; erneutes Einladen möglich

### C. Küchenverwaltung

Flow: Settings → Küche umbenennen (Feld ändern + „Umbenennen“) → Titel/Feld
aktualisiert. Zweite Küche „E2E-Zwei“ erstellen → **Umschalter erscheint**
(Dropdown „Aktive Küche“). Umschalten und prüfen, dass ALLE Bereiche wechseln:
Bestand leer, Einkauf leer (Badge!), Archiv leer, Kategorien/Lagerorte 0,
Mitgliederliste der neuen Küche. Zurückschalten → alte Daten wieder da.
Inventar-Header zeigt bei ≥ 2 Küchen den Küchennamen als Untertitel.

- EC-C1: Umbenennen mit leerem Namen → abgelehnt
- EC-C2: nach Umschalten Produkt in Küche 2 anlegen → erscheint NICHT in Küche 1 (Isolation)
- EC-C3: Küche löschen (Owner, confirm-Override): mit der NICHT-aktiven vs. der aktiven Küche — nach Löschen der aktiven muss die App auf die verbleibende wechseln bzw. ohne Küchen auf `/setup`
- EC-C4: „Verlassen“ als Nicht-Owner: danach kein Zugriff mehr; als Owner darf der Button gar nicht angeboten werden (stattdessen Löschen)
- EC-C5: Küche löschen, deren Registrierungs-Code noch offen ist → Code bleibt als neutraler Code in der Liste (ohne Küchen-Zeile)

### D. Mitglieder, Einladungen & Codes

Flow (zwei Accounts): anna (admin) lädt `e2e-ben` per **Formular** (Name +
Rolle) ein → erscheint als „eingeladen · Rolle“ mit X. ben meldet sich an →
Dialog → Beitreten → Mitglied. Rollen ändern per Dropdown. Mitglied entfernen
(confirm-Override). Code-Karte: erzeugen (mit/ohne Küchen-Checkbox, Rolle),
Kopieren-Feedback, benutzten Code („benutzt von …“), unbenutzten widerrufen.

- EC-D1: Einladung an nicht existenten Namen → „Kein Account…“-Meldung
- EC-D2: Einladung an bereits eingeladenen/bereits Mitglied → Fehlermeldung, keine Doppel-Zeile
- EC-D3: Einladung widerrufen BEVOR ben sie annimmt → bei ben verschwindet sie (Live-Update bzw. nächster App-Fokus), Annehmen unmöglich
- EC-D4: ben lehnt ab → anna kann erneut einladen
- EC-D5: Owner hat kein Rollen-Dropdown und kein X (nicht entfernbar/degradierbar)
- EC-D6: Mitglied entfernen, während ben eingeloggt ist → was sieht ben beim nächsten Navigieren? (Erwartung: fliegt auf `/setup` bzw. Fallback-Küche, keine Endlos-Fehler)
- EC-D7: benutzten Code widerrufen → X gar nicht erst angeboten (nur „benutzt von“)
- EC-D8: Nicht-Admin (write-Rolle): Code-Karte ohne Küchen-Checkbox; Mitglieder-Formular nicht sichtbar
- EC-D9: Transfer: nur Owner sieht die Sektion; nach Transfer sofortiger UI-Wechsel der Badges; Ex-Owner kann verlassen

### E. Rollen-Gating je Screen (read / write / admin)

Matrix mit `e2e-ben` in jeder Rolle einmal durchgehen (Rolle von anna ändern,
ben lädt neu). Pro Rolle prüfen:

| Bereich                                         | read                       | write | admin |
|-------------------------------------------------|----------------------------|-------|-------|
| Bestand „+“                                     | ✗                         | ✓    | ✓    |
| Detail: Level/±/Paket/Speichern/Löschen         | ✗ (disabled/ausgeblendet) | ✓    | ✓    |
| Einkauf: Formular/Abhaken/Entfernen/Abschließen | ✗                         | ✓    | ✓    |
| Settings: Listen „Bearbeiten“                   | ✗                         | ✓    | ✓    |
| Küche umbenennen / Mitglieder / Einladungen     | ✗                         | ✗    | ✓    |
| Küchen-Checkbox bei Codes                       | ✗                         | ✗    | ✓    |

- EC-E1: als read direkt `/products/new` per URL aufrufen → Formular muss unbenutzbar sein (kein Anlegen-Button/disabled); POST darf nie abgesetzt werden
- EC-E2: als read `PATCH`-Versuche via UI unmöglich; zur Sicherheit Netzwerk beobachten: es dürfen 0 schreibende Requests auftreten
- EC-E3: Rollen-Änderung wirkt bei ben (Live-Update bzw. nach Reload; my_role kommt über /api/kitchens)

### F. Kategorien & Lagerorte (editierbare Listen)

Flow: aufklappen → Bearbeiten → umbenennen (Zeile editieren), Zeile per X
löschen, per Drag-Handle umsortieren, neue Zeile per „+ Zeile“ und per Enter →
Speichern. Reihenfolge muss sich im Bestand (Gruppen-Reihenfolge bzw.
Chip-Reihenfolge) und in den Produkt-Dropdowns widerspiegeln.

- EC-F1: Kategorie löschen, der Produkte zugeordnet sind → Produkte rutschen unter „Ohne Kategorie“, Produkt-Detail zeigt „Keine“
- EC-F2: Lagerort löschen analog → Filter-Chip verschwindet, Produkt ohne Tag
- EC-F3: Abbrechen verwirft alle Änderungen; Einklappen während Bearbeitung verwirft ebenfalls
- EC-F4: leere Zeile beim Speichern → wird ignoriert (kein leerer Eintrag)
- EC-F5: Name auf leer editieren + speichern → Eintrag bleibt unverändert (kein Löschen durch Leeren)
- EC-F6: Drag per Automatisierung: `left_click_drag` vom Handle; falls CDK nicht reagiert → als „nicht automatisierbar“ notieren, nicht als Bug

### G. Produkte (Definition)

Flow: bearbeiten (Einstellungen-Sektion im Detail aufklappen): Name, Kategorie,
Lagerort, Notiz ändern → Speichern → Werte bleiben nach Reload. Produkt
löschen (confirm-Override) → aus Bestand verschwunden, offener Auto-Eintrag
verschwindet, Archiv-Einträge bleiben. Suche im Bestand (Teilstring,
Groß/klein), Lagerort-Chips filtern. Kaufdatum-Modus: Produkt mit
„Kaufdatum (Alter)“, Paket hinzufügen (Datum vorbelegt heute) → Anzeige „neu“,
Paket mit Datum vor 3 Tagen (per Dialogfeld) → „vor 3 Tagen“.

- EC-G1: Name leeren + Speichern → Fehlermeldung „Name darf nicht leer sein“
- EC-G2: Paketgröße von 1 auf 10 ändern, WÄHREND Status-Bestand existiert → Verhalten dokumentieren (Typwechsel mit Alt-Paketen ist fachlich heikel: Anzeige „gesamt“, ±, Auto-Logik). Ebenso 10 → 1 mit Zähler-Beständen.
- EC-G3: MHD-Modus wechseln (expiry → none → purchaseDate) bei vorhandenen Paketen → alte Daten bleiben/verschwinden? Kein Crash, konsistente Caption.
- EC-G4: Schwelle auf „Nie automatisch“ → Auto-Eintrag verschwindet sofort
- EC-G5: Produktname ändern, während er auf der Einkaufsliste steht → Listeneintrag folgt dem neuen Namen
- EC-G6: Suche + Chip kombiniert; Suche ohne Treffer → „Nichts gefunden“
- EC-G7: sehr langer Name (60+ Zeichen) → Layout bricht nicht (truncate)

### H. Bestand / Pakete (⚠ Sync-Pfad, höchste Priorität)

Nach JEDER Aktion hier: UI-Wert UND DB-Wert vergleichen (SQL §1.3), plus
Netzwerk (PATCH/POST/DELETE mit 2xx).

Flow Zähler-Produkt: Paket (10) anlegen → − klickt 10→9 (PATCH), + zurück,
mehrfach schnell hintereinander (5× − in <2 s) → am Ende UI == DB. Zweites
Paket → nur oberstes hat ±. Oberstes auf 0 → Paket verschwindet, nächstes
rückt nach (UI und DB). Status-Produkt: „Leer“ → aktuelles Paket weg,
Nachfüllpaket rückt nach (das am frühesten ablaufende); Nachfüll-Minus wirft
ein Paket weg (DB!), bei 0 disabled. Detailseite zeigt bei früher ablaufendem
Nachfüllpaket den Hinweis „Ein Nachfüllpaket läuft früher ab (…)“; die
Bestandsliste warnt über das dringendste Paket.

- EC-H1 (**Muster §2.2a**): Paket hinzufügen und INNERHALB von 1–2 s Level/± ändern → die Änderung muss das OFFENE (bisherige) Paket treffen, das neue reiht sich dahinter ein; DB muss beides zeigen; danach Seite neu laden → identischer Stand
- EC-H2: dasselbe offline-nah: 2 Aktionen in derselben Sekunde (Outbox-Kollaps) → Endwert zählt
- EC-H3: − unter 0 nicht möglich; keine negativen `remaining` in DB
- EC-H4: Status „Leer“ beim LETZTEN Paket → „Kein Bestand.“, Auto-Eintrag erscheint (falls Schwelle gesetzt)
- EC-H5: nach Trip-Abschluss offene Produktseite → zeigt neue Pakete korrekt (Live-Update, spätestens nach Navigation/Reload)
- EC-H6: zweiter Client simuliert: Änderung per API einspielen (§2.1) → Produktseite zeigt den Serverstand binnen ~2 s ohne Reload

### I. Auto-Einkaufsliste & Snooze

Flow: Status-Produkt Schwelle „Knapp + Nachfüll max 1“; Zähler Schwelle 4.
Zustände durchspielen und Liste jeweils prüfen (Badge + Einträge):
voll+2 Nachfüll (nein) → 1 Nachfüll (nein, current voll) → current Knapp (ja)
→ auffüllen (weg). Zähler: 10 (nein) → auf 4 (ja) → auf 5 (weg).

- EC-I1 (Snooze): Auto-Eintrag mit X entfernen → verschwindet und **kommt bei
  weiterem Unterschreiten NICHT wieder**; erst auffüllen (über Schwelle) und
  wieder unterschreiten → Eintrag frisch da. DB: `ignored_until_restock`.
- EC-I2: Auto-Eintrag abhaken, dann wieder ent-haken → bleibt Auto-Eintrag (kein Duplikat)
- EC-I3: Refill-Dominanz: Status-Produkt „Voll“, 0 Nachfüll, Schwelle „Knapp+1“ → steht auf der Liste (gewollt; als Verhalten dokumentieren, falls verwirrend)
- EC-I4: Produkt soft-löschen mit offenem Auto-Eintrag → Eintrag weg

### J. Einkaufsliste & Checkoff

Flow: Autocomplete — Produktnamen tippen → Vorschlag aus datalist übernehmen →
Eintrag ist mit Produkt verknüpft (nach Kauf landet Bestand!). Checkoff mit
**3 Paketen**: „Wie viele? 3“ → Weiter → 3 Zeilen; „Alle auf“ 1 Datum setzen →
alle Felder gefüllt; 1 Zeile abweichend ändern → Eingepackt. Abhaken
rückgängig (Kreis erneut) → offen. Manuellen Eintrag entfernen (X) → weg
(DB: gelöscht, nicht gesnoozt).

- EC-J1: freier Eintrag (kein Produktname) → Abhaken OHNE Dialog direkt in den Warenkorb
- EC-J2: manueller Eintrag mit EXAKT gleichem Namen wie ein Produkt (andere Groß-/Kleinschreibung) → wird er verknüpft? Verhalten dokumentieren
- EC-J3: Abhaken → un-check → erneut abhaken: Dialog kommt wieder, alter Plan überschrieben (Bestand am Ende = letzter Plan, per DB prüfen)
- EC-J4: Menge im Dialog 0 oder negativ → wird auf ≥1 korrigiert
- EC-J5: Zähler-Produkt: Paketgröße im Dialog ändern (z. B. 6 statt 10) → Bestand nach Abschluss = 6er-Paket
- EC-J6: Liste bei zwei Einträgen, nur einen abhaken, abschließen → der andere bleibt liegen
- EC-J7: „Einkauf abschließen“-Karte: Abbrechen → nichts passiert; Badge zählt offene+Warenkorb korrekt

### K. Trip & Archiv

Flow: Abschluss ohne Preis (leer) → Archivkarte ohne Betrag. Abschluss mit
Preis. Mehrere Trips → Sortierung neueste zuerst; mehrere Karten unabhängig
auf-/zuklappbar; Farbe+Name des Abschließenden korrekt.

- EC-K1: Preis mit Komma „12,34“ eingeben (deutsches Format in `input[type=number]`) → was passiert? (leer/ungültig/12.34?) dokumentieren
- EC-K2: Preis 0 → wird 0.00 € angezeigt oder wie „kein Preis“ behandelt?
- EC-K3: Trip eines gelöschten Produkts → Name bleibt im Archiv (Snapshot)

### L. Sprache & Farben

- Sprache auf Login-Screen wechseln (Flagge) → gilt sofort; nach Registrierung/Login übernommen; in Settings wechseln → nach Logout/Login bleibt sie (Account-Persistenz)
- EC-L1: EN wählen, App durchklicken → keine deutschen Resttexte/fehlende Keys (`translate`-Platzhalter)
- Farben: eigene Farbe ändern (per JS/`form_input` am color-Input) → Punkt aktualisiert sich in Mitgliederliste, Einkaufsliste (added_by) und Archiv (completed_by)
- EC-L2: Datum-Formate im Archiv folgen der Sprache (DD.MM. vs EN-Format)

### M. Sync-Beobachtungen (online)

- Während der gesamten Läufe Konsole auf Fehler filtern (`onlyErrors`) und am
  Ende `.dev/backend.log` nach `" 5"`xx-Statuscodes greppen — jeden 500er als
  Befund aufnehmen.
- **Live-Updates (SSE):** beliebige Seite offen lassen, per API (zweites
  Session-Cookie) eine Änderung einspielen → erscheint binnen ~1–2 s ohne
  Reload. Quer-Effekte mitprüfen: Bestandsänderung → Einkaufs-Badge folgt
  live; Paket auffüllen → Auto-Eintrag verschwindet live.
- **Kein Polling:** Seite ≥ 30 s in Ruhe beobachten → außer dem offenen
  `/events`-Stream dürfen 0 API-Requests auftreten (Muster §2.2b).
- Heap-Check zu Beginn/Ende eines langen Laufs (`performance.memory`) —
  auffälliges Wachstum (> Faktor 3) notieren.

---

## 4. Reihenfolge-Empfehlung für einen Lauf

1. Setup (§1) → A → B (inkl. B3-Loop-Check)
2. C (zweite Küche früh anlegen — der Umschalter wird danach überall mitgeprüft)
3. F → G → H (⚠) → I → J → K in EINER Küche am Stück (baut aufeinander auf)
4. D → E mit `e2e-ben` (Rollen-Matrix)
5. L, M nebenher/abschließend
6. Cleanup (§1.2 Punkt 4) + Befundreport abgeben
