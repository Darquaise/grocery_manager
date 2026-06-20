"""The auto shopping-list behaviour — the core of the app."""


def items(c):
    return c.get("/api/shopping/items").json()


def names(c):
    return sorted(i["display_name"] for i in items(c))


def test_status_crosses_threshold(auth_client, make_product):
    # status product, full (2), default threshold knapp (1).
    p = make_product(name="Käse", tracking_type="status", current_value=2, min_value=1)
    assert names(auth_client) == []

    # Drop to knapp (1 <= 1) -> auto entry appears, name only.
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 1})
    autos = items(auth_client)
    assert len(autos) == 1
    assert autos[0]["source"] == "auto"
    assert autos[0]["display_name"] == "Käse"
    assert autos[0]["amount_text"] is None

    # Drop further to empty -> still exactly one entry (not duplicated).
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 0})
    assert len(items(auth_client)) == 1

    # Refill to full -> entry clears.
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 2})
    assert names(auth_client) == []


def test_status_threshold_at_medium_level(auth_client, make_product):
    # 5-level status (empty=0 … full=4); threshold "Mittel" (2).
    p = make_product(name="Shampoo", tracking_type="status", current_value=4, min_value=2)
    assert names(auth_client) == []  # voll
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 3})
    assert names(auth_client) == []  # fast voll -> noch über der Schwelle
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 2})
    assert names(auth_client) == ["Shampoo"]  # mittel = Schwelle -> auf die Liste (<=)


def test_created_below_min_lists_immediately(auth_client, make_product):
    make_product(name="Mehl", tracking_type="counter", current_value=0, min_value=1)
    assert names(auth_client) == ["Mehl"]


def test_min_none_never_lists(auth_client, make_product):
    make_product(name="Salz", tracking_type="counter", current_value=0, min_value=None)
    assert names(auth_client) == []


def test_counter_threshold_is_inclusive(auth_client, make_product):
    p = make_product(name="Eier", tracking_type="counter", current_value=5, min_value=2)
    assert names(auth_client) == []
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 2})
    assert names(auth_client) == ["Eier"]  # 2 <= 2
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 3})
    assert names(auth_client) == []


def test_snooze_until_restock(auth_client, make_product):
    p = make_product(name="Butter", tracking_type="status", current_value=1, min_value=1)
    auto = items(auth_client)
    assert len(auto) == 1

    # Wipe the auto entry -> snoozed, gone from the list.
    auth_client.delete(f"/api/shopping/items/{auto[0]['id']}")
    assert names(auth_client) == []

    # Still below min: it must NOT come back.
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 0})
    assert names(auth_client) == []

    # Refilled above min, then drops below again -> reappears fresh.
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 2})
    assert names(auth_client) == []
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 1})
    assert names(auth_client) == ["Butter"]


def test_soft_delete_removes_auto_entry(auth_client, make_product):
    p = make_product(name="Joghurt", tracking_type="status", current_value=0, min_value=1)
    assert names(auth_client) == ["Joghurt"]
    auth_client.delete(f"/api/products/{p['id']}")
    assert names(auth_client) == []


def test_manual_and_free_items(auth_client):
    auth_client.post("/api/shopping/items", json={"display_name": "Grillkohle"})
    auth_client.post(
        "/api/shopping/items", json={"display_name": "Tomaten", "amount_text": "2 kg"}
    )
    listing = items(auth_client)
    assert sorted(i["display_name"] for i in listing) == ["Grillkohle", "Tomaten"]
    assert all(i["source"] == "manual" for i in listing)
    tomaten = next(i for i in listing if i["display_name"] == "Tomaten")
    assert tomaten["amount_text"] == "2 kg"
    assert tomaten["added_by"] is not None  # colour marker
