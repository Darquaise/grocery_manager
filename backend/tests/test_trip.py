"""Completing a shopping trip: archive + materialising the purchase plan into stock."""


def items(c):
    return c.get(f"{c.k}/shopping/items").json()


def check_off(c, item_id, **body):
    body["state"] = "inCart"
    assert c.patch(f"{c.k}/shopping/items/{item_id}", json=body).status_code == 200


def test_complete_materializes_stock_and_archives(auth_client, make_product):
    status_p = make_product(
        name="Spüli", package_size=1, can_expire="expiry",
        reorder_status_level=1, reorder_refill_count=0,
    )
    counter_p = make_product(
        name="Eier", package_size=10, can_expire="none", reorder_total_units=2
    )
    auth_client.post(f"{auth_client.k}/shopping/items", json={"display_name": "Brot"})  # free item

    by_name = {i["display_name"]: i for i in items(auth_client)}
    check_off(auth_client, by_name["Spüli"]["id"], purchase_plan=[{"expiry_date": "2026-09-01"}])
    check_off(auth_client, by_name["Eier"]["id"], purchase_plan=[{"size": 10}, {"size": 6}])
    check_off(auth_client, by_name["Brot"]["id"])

    resp = auth_client.post(f"{auth_client.k}/shopping/complete", json={"total_price": 42.5})
    assert resp.status_code == 200, resp.text
    trip = resp.json()
    assert trip["total_price"] == 42.5
    assert trip["completed_by"] is not None
    assert sorted(i["display_name"] for i in trip["items"]) == ["Brot", "Eier", "Spüli"]

    # status: one full package carrying the chosen expiry.
    sp = auth_client.get(f"{auth_client.k}/products/{status_p['id']}").json()
    assert sp["total_units"] == 1
    assert sp["current_level"] == 4
    assert sp["current_expiry_date"] == "2026-09-01"

    # counter: two packages (10 + 6 units).
    cp = auth_client.get(f"{auth_client.k}/products/{counter_p['id']}").json()
    assert cp["total_units"] == 16
    assert len(cp["stock"]) == 2

    # Bought entries cleared; refilled products dropped off the auto list.
    assert items(auth_client) == []

    trips = auth_client.get(f"{auth_client.k}/shopping/trips").json()
    assert len(trips) == 1
    assert auth_client.get(f"{auth_client.k}/shopping/trips/{trip['id']}").status_code == 200


def test_complete_without_plan_adds_one_package(auth_client, make_product):
    p = make_product(
        name="Tee", package_size=1, reorder_status_level=1, reorder_refill_count=0
    )
    item = items(auth_client)[0]
    check_off(auth_client, item["id"])
    auth_client.post(f"{auth_client.k}/shopping/complete", json={})

    out = auth_client.get(f"{auth_client.k}/products/{p['id']}").json()
    assert out["total_units"] == 1
    assert items(auth_client) == []


def test_complete_empty_cart_is_400(auth_client, make_product):
    make_product(name="Tee", package_size=1, reorder_status_level=1, reorder_refill_count=0)
    # Item is on the list but nothing checked off.
    assert auth_client.post(f"{auth_client.k}/shopping/complete", json={}).status_code == 400


def test_unchecked_items_stay_on_list(auth_client):
    auth_client.post(f"{auth_client.k}/shopping/items", json={"display_name": "A"})
    auth_client.post(f"{auth_client.k}/shopping/items", json={"display_name": "B"})
    a = next(i for i in items(auth_client) if i["display_name"] == "A")
    check_off(auth_client, a["id"])

    auth_client.post(f"{auth_client.k}/shopping/complete", json={})
    remaining = [i["display_name"] for i in items(auth_client)]
    assert remaining == ["B"]
