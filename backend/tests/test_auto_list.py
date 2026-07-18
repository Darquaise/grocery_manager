"""The auto shopping-list behaviour — the core of the app."""


def items(c):
    return c.get(f"{c.k}/shopping/items").json()


def names(c):
    return sorted(i["display_name"] for i in items(c))


def test_status_threshold_level_and_refill(auth_client, make_product, add_stock):
    # Milch: auf die Liste wenn aktueller Stand <= Mittel(2) UND Nachfüll <= 1.
    p = make_product(
        name="Milch", package_size=1, reorder_status_level=2, reorder_refill_count=1
    )
    pid = p["id"]

    # current full + 2 refills -> refill_count 2 > 1 -> nicht auf der Liste
    add_stock(pid)
    add_stock(pid)
    add_stock(pid)
    assert names(auth_client) == []

    # ein Nachfüllpaket weg -> refill 1 <= 1, aber aktueller voll(4) > 2 -> nicht
    out = auth_client.get(f"{auth_client.k}/products/{pid}").json()
    auth_client.delete(f"{auth_client.k}/products/{pid}/stock/{out['stock'][-1]['id']}")
    assert names(auth_client) == []

    # aktuelles auf Mittel(2): 2<=2 UND refill 1<=1 -> auf die Liste
    out = auth_client.get(f"{auth_client.k}/products/{pid}").json()
    auth_client.patch(
        f"{auth_client.k}/products/{pid}/stock/{out['stock'][0]['id']}", json={"status_level": 2}
    )
    assert names(auth_client) == ["Milch"]


def test_status_refill_count_dominates(auth_client, make_product, add_stock):
    # "Knapp + 1 Nachfüll": auch bei vollem aktuellem Paket auf die Liste, solange
    # kein Nachfüllpaket da ist (0 Nachfüll < 1 benötigt).
    p = make_product(
        name="Milch", package_size=1, reorder_status_level=1, reorder_refill_count=1
    )
    pid = p["id"]
    add_stock(pid)  # 1 volles Paket -> aktuell voll, 0 Nachfüll
    out = auth_client.get(f"{auth_client.k}/products/{pid}").json()
    assert out["current_level"] == 4
    assert out["refill_count"] == 0
    assert names(auth_client) == ["Milch"]

    # Zweites Paket -> 1 Nachfüll, aktuell voll -> ausreichend, runter von der Liste
    add_stock(pid)
    assert names(auth_client) == []


def test_status_no_threshold_never_lists(auth_client, make_product):
    make_product(name="Salz", package_size=1, reorder_status_level=None)
    assert names(auth_client) == []


def test_counter_total_units_threshold(auth_client, make_product, add_stock):
    p = make_product(name="Eier", package_size=10, reorder_total_units=4)
    pid = p["id"]
    add_stock(pid, size=10, remaining=10)
    assert names(auth_client) == []  # 10 > 4

    out = auth_client.get(f"{auth_client.k}/products/{pid}").json()
    auth_client.patch(
        f"{auth_client.k}/products/{pid}/stock/{out['stock'][0]['id']}", json={"remaining": 4}
    )
    assert names(auth_client) == ["Eier"]  # 4 <= 4


def test_counter_created_empty_lists_immediately(auth_client, make_product):
    make_product(name="Mehl", package_size=10, reorder_total_units=1)
    assert names(auth_client) == ["Mehl"]  # 0 <= 1


def test_counter_total_none_never_lists(auth_client, make_product):
    make_product(name="Salz", package_size=10, reorder_total_units=None)
    assert names(auth_client) == []


def test_snooze_until_restock(auth_client, make_product, add_stock):
    # "Voll + 0 Nachfüll": auf die Liste solange kein Nachfüllpaket da ist.
    p = make_product(
        name="Butter", package_size=1, reorder_status_level=4, reorder_refill_count=0
    )
    pid = p["id"]
    auto = items(auth_client)  # leer -> auf der Liste
    assert len(auto) == 1

    # Auto-Eintrag wegwischen -> snoozed
    auth_client.delete(f"{auth_client.k}/shopping/items/{auto[0]['id']}")
    assert names(auth_client) == []

    # Weiter unter der Schwelle -> darf NICHT zurückkommen
    assert names(auth_client) == []

    # Über die Schwelle (2 Pakete -> refill 1) und wieder darunter -> frisch zurück
    add_stock(pid)
    add_stock(pid)
    assert names(auth_client) == []
    out = auth_client.get(f"{auth_client.k}/products/{pid}").json()
    auth_client.delete(f"{auth_client.k}/products/{pid}/stock/{out['stock'][-1]['id']}")
    assert names(auth_client) == ["Butter"]


def test_soft_delete_removes_auto_entry(auth_client, make_product):
    p = make_product(
        name="Joghurt", package_size=1, reorder_status_level=4, reorder_refill_count=0
    )
    assert names(auth_client) == ["Joghurt"]  # leer -> auf der Liste
    auth_client.delete(f"{auth_client.k}/products/{p['id']}")
    assert names(auth_client) == []


def test_manual_and_free_items(auth_client):
    auth_client.post(f"{auth_client.k}/shopping/items", json={"display_name": "Grillkohle"})
    auth_client.post(
        f"{auth_client.k}/shopping/items", json={"display_name": "Tomaten", "amount_text": "2 kg"}
    )
    listing = items(auth_client)
    assert sorted(i["display_name"] for i in listing) == ["Grillkohle", "Tomaten"]
    assert all(i["source"] == "manual" for i in listing)
    tomaten = next(i for i in listing if i["display_name"] == "Tomaten")
    assert tomaten["amount_text"] == "2 kg"
    assert tomaten["added_by"] is not None  # colour marker
