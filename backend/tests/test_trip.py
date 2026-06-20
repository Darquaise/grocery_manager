"""Completing a shopping trip: archive + the post-purchase "full" value logic."""


def items(c):
    return c.get("/api/shopping/items").json()


def check_off(c, item_id):
    assert c.patch(f"/api/shopping/items/{item_id}", json={"state": "inCart"}).status_code == 200


def test_complete_applies_full_value_and_archives(auth_client, make_product):
    status_p = make_product(name="Spüli", tracking_type="status", current_value=1, min_value=1)
    amount_p = make_product(
        name="Reis", tracking_type="amount", unit="g", current_value=100,
        min_value=200, full_value=1000,
    )
    auth_client.post("/api/shopping/items", json={"display_name": "Brot"})  # free item

    for item in items(auth_client):
        check_off(auth_client, item["id"])

    resp = auth_client.post("/api/shopping/complete", json={"total_price": 42.5})
    assert resp.status_code == 200, resp.text
    trip = resp.json()
    assert trip["total_price"] == 42.5
    assert trip["completed_by"] is not None
    assert sorted(i["display_name"] for i in trip["items"]) == ["Brot", "Reis", "Spüli"]

    # Full-value logic applied (status -> full = ordinal 4).
    assert auth_client.get(f"/api/products/{status_p['id']}").json()["current_value"] == 4
    assert auth_client.get(f"/api/products/{amount_p['id']}").json()["current_value"] == 1000

    # Bought entries cleared from the active list; refilled products dropped off.
    assert items(auth_client) == []

    # Archived and retrievable.
    trips = auth_client.get("/api/shopping/trips").json()
    assert len(trips) == 1
    assert auth_client.get(f"/api/shopping/trips/{trip['id']}").status_code == 200


def test_complete_empty_cart_is_400(auth_client, make_product):
    make_product(name="Tee", tracking_type="status", current_value=0, min_value=1)
    # Item is on the list but nothing checked off.
    assert auth_client.post("/api/shopping/complete", json={}).status_code == 400


def test_unchecked_items_stay_on_list(auth_client):
    auth_client.post("/api/shopping/items", json={"display_name": "A"})
    auth_client.post("/api/shopping/items", json={"display_name": "B"})
    a = next(i for i in items(auth_client) if i["display_name"] == "A")
    check_off(auth_client, a["id"])

    auth_client.post("/api/shopping/complete", json={})
    remaining = [i["display_name"] for i in items(auth_client)]
    assert remaining == ["B"]


def test_valueless_product_reappears_until_amount_recorded(auth_client, make_product):
    """A product without a "full" value is only marked bought; its stored value
    stays low, so it returns to the list until the exact amount is recorded."""
    p = make_product(name="Nudeln", tracking_type="counter", current_value=0, min_value=1)
    item = items(auth_client)[0]
    check_off(auth_client, item["id"])
    auth_client.post("/api/shopping/complete", json={})

    assert [i["display_name"] for i in items(auth_client)] == ["Nudeln"]
    # Recording the real amount above min clears it.
    auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 5})
    assert items(auth_client) == []
