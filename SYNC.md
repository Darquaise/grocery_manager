# Sync-Architektur — ein Schreibpfad, zwei Ausgänge

Stand: 19.07.2026 · Code: `services/sync.ts`, `services/live.ts`,
`services/offline-db.ts`, `services/connectivity.ts`,
`interceptors/connectivity-interceptor.ts`,
`pages/product-detail/product-detail.ts` · Backend: `events.py`,
Middleware in `main.py`, SSE-Endpoint in `api/kitchens.py`

## Die Kernaussage in einem Bild

**Es gibt keinen getrennten Online-Pfad.** Jede Schreibaktion nimmt immer
denselben Weg. Ob Netz da ist, entscheidet sich erst ganz am Ende — an genau
einer Gabelung:

```mermaid
flowchart LR
    U(["Nutzer tippt"]) --> S["UI-Signal<br/>sofort sichtbar"]
    S --> O[("Outbox")]
    O --> F{"flush()"}
    F -->|"Antwort kommt an"| OK["Op gelöscht,<br/>Serverwahrheit in den Cache"]
    F -->|"Status 0 —<br/>keine Antwort"| W["Op bleibt liegen,<br/>»ausstehend«"]
    W -.->|"Reconnect"| F
```

Die UI ist in **beiden** Fällen sofort aktuell — sie wartet nie auf den Server.
Offline bleibt die Op einfach in der Outbox liegen, bis ein Reconnect sie
nachliefert. Genau deshalb fühlt sich die App offline identisch an.

## Wer ist wer

| Kürzel | Baustein                 | Aufgabe                                                          |
|--------|--------------------------|------------------------------------------------------------------|
| `UI`   | ProductDetail / Shopping | schreibt optimistisch ins Signal, reiht die Op ein               |
| `SY`   | `SyncService`            | Outbox verwalten, `flush()`, Temp-IDs auflösen, Konflikte melden |
| `LV`   | `LiveService`            | SSE-Verbindung + `rev`-Signal: Änderungen anderer Geräte         |
| `DB`   | IndexedDB                | `cache` (Lesen offline) + `outbox` (Schreiben offline, FIFO)     |
| `IC`   | Connectivity-Interceptor | erkennt am echten Antwortverhalten, ob wir online sind           |
| `API`  | Backend                  | die einzige Quelle der Wahrheit                                  |

Der Online-Zustand kommt **primär** aus echtem Antwortverhalten: jede
*erfolgreiche* Antwort setzt `online = true`, Status 0 (nichts kam an) setzt
`online = false`. 4xx/5xx lassen ihn unangetastet — der Server ist ja
erreichbar, nur die Anfrage war schlecht. `navigator.onLine` ist trotzdem nicht
ganz raus: er liefert den Startwert, und die Browser-Events `online`/`offline`
setzen das Signal zusätzlich als Hinweis (`ConnectivityService`).

---

## 1 · Der Schreibvorgang

Bis `flush()` ist alles identisch. Der Unterschied zwischen online und offline
ist die eine `alt`-Gabelung unten.

```mermaid
sequenceDiagram
    autonumber
    actor U as Nutzer
    participant UI as UI
    participant SY as SyncService
    participant DB as IndexedDB
    participant IC as Interceptor
    participant API as Backend

    U->>UI: "−" bzw. Status "Leer" tippen
    UI->>UI: commit() — Signal neu, UI ist sofort aktuell
    UI->>DB: putCached(product) — Cache optimistisch überschrieben
    UI->>SY: enqueue(stock.adjust)
    Note right of SY: baseUpdatedAt = online ? null : item.updated_at<br/>Die Konflikt-Basis entsteht nur offline
    SY->>DB: addOp() — bestehende Adjust-Op derselben stockId wird ersetzt
    Note over SY,DB: 5× "−" ergeben EINE Op: Endwert gewinnt
    SY->>SY: flush()
    SY->>IC: PATCH /products/:id/stock/:sid

    alt online — die Antwort kommt an
        IC->>API: weiterleiten
        API-->>IC: 200 OK
        IC->>IC: setOnline(true)
        IC-->>SY: 200 OK
        SY->>DB: deleteOp() — Outbox wieder leer
        SY->>API: GET /products — Serverwahrheit nachziehen
        API-->>SY: Produkte inkl. echter Stock-IDs
        SY->>DB: setCache(products)
        SY-->>UI: stockSynced++ → refreshStockFromCache()
        UI->>UI: Temp-IDs durch echte Server-IDs ersetzt
    else offline — nichts kommt an
        IC--xAPI: keine Verbindung
        IC->>IC: Status 0 → setOnline(false)
        IC-->>SY: HttpErrorResponse status 0
        SY->>SY: break — Op bleibt, Queue-Reihenfolge unangetastet
        SY->>SY: refreshState() → pending, pendingProductIds
        SY-->>UI: »ausstehend«-Marker — der Wert bleibt trotzdem stehen
        Note over U,API: Weiterarbeiten geht: Lesen aus dem Cache,<br/>neue Pakete bekommen Temp-IDs (-Date.now()).<br/>Aufgelöst wird das in Diagramm 2.
    end
```

---

## 2 · Der Reconnect

Kein Gegenstück zu Diagramm 1, sondern ein eigenes Ereignis: es hat einen
eigenen Auslöser und Logik, die es online nie braucht.

Das Beispiel ist der heikelste reale Fall — offline ein Paket angelegt **und**
direkt danach auf demselben Paket „Leer" getippt. Op 2 zeigt dabei auf eine ID,
die es serverseitig noch gar nicht gibt.

```mermaid
sequenceDiagram
    autonumber
    actor U as Nutzer
    participant UI as UI
    participant SY as SyncService
    participant DB as IndexedDB
    participant API as Backend

    Note over U,API: Auslöser: online-Event · App-Fokus (visibilitychange) ·<br/>App-Start · nächste Mutation

    SY->>DB: allOps() — Outbox in Reihenfolge lesen
    Note right of SY: jede Op trägt ihre kitchenId:<br/>offline in Küche A geschrieben,<br/>landet auch in Küche A

    SY->>API: POST /products/:id/stock — Op 1: stock.add
    API-->>SY: 201 + created_stock_id = 22
    SY->>SY: stockIdMap: -1752... → 22
    SY->>DB: deleteOp(Op 1)

    SY->>SY: realStockId(-1752...) → 22 — Op 2: stock.adjust
    Note right of SY: ohne diese Zuordnung würde die Op mangels<br/>echter ID stillschweigend übersprungen
    SY->>API: PATCH .../stock/22 — mit expected_updated_at

    alt Serverstand unverändert
        API-->>SY: 200 OK
        SY->>DB: deleteOp(Op 2)
    else jemand anderes war schneller
        API-->>SY: 409 + aktueller Serverstand
        SY->>SY: recordStockConflict() → conflicts-Signal
        SY->>DB: deleteOp(Op 2) — darf die Queue nicht blockieren
        SY-->>UI: Konflikt-Dialog
        alt Nutzer behält seinen Wert
            U->>SY: resolveKeepMine() — neu einreihen, Basis = Server-updated_at
        else Nutzer übernimmt den Serverwert
            U->>SY: resolveKeepTheirs() — verwerfen, Produkte neu laden
        end
    end

    Note over SY,API: einmal am Ende, nicht pro Op
    SY->>API: GET /products bzw. GET /shopping/items
    SY->>DB: setCache(...)
    SY-->>UI: stockSynced++ / reloadFromServer()<br/>Serverwahrheit übernommen, Temp-IDs verschwinden

    opt während des Laufs wurde erneut geflusht
        SY->>SY: flushAgain → noch ein Durchlauf
    end
```

---

## 3 · Live-Updates (die andere Richtung)

Diagramm 1/2 sind *meine* Schreibvorgänge. Änderungen **anderer** Geräte kommen
per Server-Push herein — es gibt kein Polling:

- **Backend:** Jede erfolgreiche Mutation unter `/api/kitchens/{id}/…` bumpt
  über eine Middleware einen Revisionszähler pro Küche (`events.bus`, rein im
  Prozessspeicher — Produktion läuft als ein Uvicorn-Prozess). Mutationen ohne
  Küchen-ID in der URL (Invite annehmen/ablehnen, Registrierung mit
  Küchen-Code, Farbwechsel) bumpen explizit am Endpoint.
  `GET /api/kitchens/{id}/events` ist ein SSE-Stream: pro Bump ein
  inhaltsloses `change`-Event (Bursts werden koalesziert), alle 25 s ein
  Keepalive, `Last-Event-ID` löst beim Reconnect sofort ein Catch-up-Event aus.
- **Frontend:** `LiveService` hält pro aktiver Küche eine `EventSource` und
  bündelt alles in ein `rev`-Signal (300 ms Debounce). Events **und**
  App-Fokus/Online-Wechsel bumpen `rev` — Fokus lädt also auch bei leerer
  Outbox nach. Solange die Outbox noch Ops enthält, wird der Bump zurückgestellt
  (`dirty`) und erst nach dem Flush ausgeführt, damit ein Server-Snapshot nie
  optimistischen, noch nicht synchronisierten Zustand überschreibt.
- **Konsumenten:** Einkaufsliste (inkl. Badge), Mitglieder/Farben und
  Küchen/Rollen/Einladungen laden bei jedem `rev`-Bump zentral neu; offene
  Seiten (Bestand, Produktdetail, Archiv, Küchenverwaltung) registrieren sich
  über `live.onChange(...)`. Die Events sind bewusst inhaltslos — Konsumenten holen
  sich, was sie anzeigen, deshalb können Quer-Effekte (Bestandsänderung erzeugt
  Auto-Eintrag, Trip materialisiert Bestand) nie verloren gehen.
- **Selbstheilung:** `EventSource` reconnected von allein; gibt sie endgültig
  auf, repariert ein 30-s-Intervall die Verbindung, solange die App sichtbar
  ist (das ist kein Daten-Polling — ohne tote Verbindung passiert nichts).

Direkt in der DB ausgeführtes SQL erzeugt **kein** Event — solche Änderungen
erscheinen erst beim nächsten Fokus/Reconnect.

---

## Was die Diagramme nicht zeigen

|                          | online                               | offline                                            |
|--------------------------|--------------------------------------|----------------------------------------------------|
| `expected_updated_at`    | `null` — letzter Schreiber gewinnt   | `item.updated_at` als Konflikt-Basis, 409 möglich  |
| Lesen                    | GET, danach Cache-Refresh            | ausschließlich aus dem IndexedDB-Cache             |
| Temp-IDs (`-Date.now()`) | Sekundenbruchteile bis zur echten ID | leben bis zum Reconnect, `stockIdMap` löst sie auf |

Online wird also **bewusst kein** Konflikt geprüft: zwei Geräte, die gleichzeitig
online sind, überschreiben sich gegenseitig, letzter Klick gewinnt. Der
409-Dialog existiert ausschließlich für Änderungen, die offline entstanden sind.

## Fallstricke

- **Temp-IDs überleben den Sync.** Ein Paket, das auf einer offenen Produktseite
  angelegt und weiterbearbeitet wird, behält lokal seine negative ID auch
  nachdem der `add` durchgelaufen ist. Nur `stockIdMap` rettet die folgenden
  Adjust-/Remove-Ops. Lässt sich eine Temp-ID nicht auflösen (der `add` kam nie
  durch), wird die Op stillschweigend übersprungen. Die Map ist in IndexedDB
  persistiert und wird bei leerer Outbox aufgeräumt — sie übersteht damit auch
  einen App-Neustart zwischen geglücktem `add` und wartender Folge-Op.
- **Ops werden bei Fehlern verworfen, nicht wiederholt.** Nur Status 0 bricht die
  Schleife ab und behält die Queue. Jeder andere Fehler — auch der 409 — löscht
  die Op, damit sie den Rest nicht blockiert; verworfene Ops landen im
  persistierten `failed`-Signal und werden als Banner angezeigt, verloren geht
  also nichts *still*. Beim 409 entsteht der Ersatz erst wieder durch
  `resolveKeepMine()`; der Dialog lässt sich nicht wegklicken (nur
  „meins"/„deren"), und `conflicts` ist ebenfalls persistiert — ein Reload vor
  der Entscheidung verwirft den Konflikt nicht. Liefert der Server zufällig
  denselben Wert wie meiner, wird ohne Dialog still aufgelöst.
- **Der Collapse gilt nur für `stock.adjust`.** Mehrfaches Abhaken derselben
  Einkaufsposition erzeugt weiterhin eine `shopping.toggle`-Op pro Klick.
- **Trip-Abschluss ist online-only** (`ShoppingService.complete`) — er läuft nicht
  über die Outbox.
