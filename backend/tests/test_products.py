def test_create_list_get(auth_client, make_product, add_stock):
    created = make_product(name="Tomaten", package_size=6)
    assert created["id"] > 0
    assert created["name"] == "Tomaten"
    assert created["tracking_type"] == "counter"

    add_stock(created["id"], size=6, remaining=6)
    add_stock(created["id"], size=6, remaining=3)

    listing = auth_client.get(f"{auth_client.k}/products").json()
    assert [p["name"] for p in listing] == ["Tomaten"]
    assert listing[0]["total_units"] == 9

    one = auth_client.get(f"{auth_client.k}/products/{created['id']}").json()
    assert one["total_units"] == 9
    assert len(one["stock"]) == 2


def test_status_product_derived_type(make_product):
    p = make_product(name="Milch", package_size=1)
    assert p["tracking_type"] == "status"
    assert p["current_level"] == 0
    assert p["total_units"] == 0


def test_update_product(auth_client, make_product):
    p = make_product(name="Milch", package_size=1)
    resp = auth_client.patch(
        f"{auth_client.k}/products/{p['id']}", json={"name": "Hafermilch", "notes": "bio"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Hafermilch"
    assert body["notes"] == "bio"
    assert body["package_size"] == 1  # untouched fields stay


def test_added_package_never_displaces_the_open_one(auth_client, make_product, add_stock):
    """The package in use stays current even when a sooner-expiring one arrives —
    you finish the open package first. Otherwise a status change made right after
    adding would hit the new package (and empty/delete it)."""
    p = make_product(name="Joghurt", package_size=1, can_expire="expiry")
    add_stock(p["id"], expiry_date="2026-08-01")  # in use
    out = add_stock(p["id"], expiry_date="2026-07-01")  # expires sooner, still a refill

    assert out["current_expiry_date"] == "2026-08-01"
    assert out["refill_count"] == 1
    assert out["stock"][0]["expiry_date"] == "2026-08-01"
    assert out["stock"][0]["current_since"] is not None
    assert out["stock"][1]["current_since"] is None


def test_refill_queue_is_ordered_most_urgent_first(auth_client, make_product, add_stock):
    """Behind the open package the queue *is* sorted by expiry, so the most
    urgent refill is the one that takes over next."""
    p = make_product(name="Joghurt", package_size=1, can_expire="expiry")
    add_stock(p["id"], expiry_date="2026-09-01")  # in use
    add_stock(p["id"], expiry_date="2026-08-01")
    out = add_stock(p["id"], expiry_date="2026-07-01")
    assert [s["expiry_date"] for s in out["stock"]] == ["2026-09-01", "2026-07-01", "2026-08-01"]

    # Emptying the open one hands over to the most urgent refill.
    current_id = out["stock"][0]["id"]
    body = auth_client.patch(
        f"{auth_client.k}/products/{p['id']}/stock/{current_id}", json={"status_level": 0}
    ).json()
    assert body["current_expiry_date"] == "2026-07-01"
    assert [s["expiry_date"] for s in body["stock"]] == ["2026-07-01", "2026-08-01"]


def test_urgent_date_sees_past_the_open_package(auth_client, make_product, add_stock):
    """A refill expiring before the open package must not hide behind it — the
    inventory list warns off `urgent_*`, not off the package in use."""
    p = make_product(name="Joghurt", package_size=1, can_expire="expiry")
    add_stock(p["id"], expiry_date="2026-09-01")  # in use, far away
    out = add_stock(p["id"], expiry_date="2026-07-19")  # refill, expires first

    assert out["current_expiry_date"] == "2026-09-01"  # Status-Buttons wirken hierauf
    assert out["urgent_expiry_date"] == "2026-07-19"  # ... die Liste warnt hierüber

    # Ohne Nachfüller fallen beide zusammen.
    single = auth_client.get(f"{auth_client.k}/products/{p['id']}").json()
    assert single["urgent_expiry_date"] == "2026-07-19"


def test_urgent_date_falls_back_to_the_only_package(make_product, add_stock):
    p = make_product(name="Milch", package_size=1, can_expire="expiry")
    out = add_stock(p["id"], expiry_date="2026-07-01")
    assert out["urgent_expiry_date"] == out["current_expiry_date"] == "2026-07-01"


def test_first_package_of_a_product_becomes_current(make_product, add_stock):
    p = make_product(name="Milch", package_size=1, can_expire="expiry")
    out = add_stock(p["id"], expiry_date="2026-07-01")
    assert out["stock"][0]["current_since"] is not None


def test_purchase_date_mode_records_today(auth_client, make_product, add_stock):
    p = make_product(name="Mehl", package_size=1, can_expire="purchaseDate")
    assert p["can_expire"] == "purchaseDate"
    out = add_stock(p["id"])
    assert out["current_purchase_date"] is not None
    assert out["current_expiry_date"] is None
    assert out["stock"][0]["purchase_date"] is not None


def test_status_consume_empties_and_promotes(auth_client, make_product, add_stock):
    p = make_product(name="Milch", package_size=1, can_expire="expiry")
    add_stock(p["id"], expiry_date="2026-07-01")  # current
    add_stock(p["id"], expiry_date="2026-08-01")  # refill
    out = auth_client.get(f"{auth_client.k}/products/{p['id']}").json()
    current_id = out["stock"][0]["id"]

    resp = auth_client.patch(
        f"{auth_client.k}/products/{p['id']}/stock/{current_id}", json={"status_level": 0}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["stock"]) == 1  # emptied package removed
    assert body["current_expiry_date"] == "2026-08-01"  # next promoted
    assert body["refill_count"] == 0


def test_counter_decrement_removes_at_zero(auth_client, make_product, add_stock):
    p = make_product(name="Eier", package_size=10)
    add_stock(p["id"], size=10, remaining=2)   # oldest -> current/top
    add_stock(p["id"], size=10, remaining=10)
    out = auth_client.get(f"{auth_client.k}/products/{p['id']}").json()
    assert out["total_units"] == 12
    top_id = out["stock"][0]["id"]

    body = auth_client.patch(
        f"{auth_client.k}/products/{p['id']}/stock/{top_id}", json={"remaining": 0}
    ).json()
    assert len(body["stock"]) == 1
    assert body["total_units"] == 10


def test_remove_stock_package(auth_client, make_product, add_stock):
    p = make_product(name="Milch", package_size=1)
    for _ in range(3):
        add_stock(p["id"])
    out = auth_client.get(f"{auth_client.k}/products/{p['id']}").json()
    assert out["total_units"] == 3
    oldest_id = out["stock"][0]["id"]

    resp = auth_client.delete(f"{auth_client.k}/products/{p['id']}/stock/{oldest_id}")
    assert resp.status_code == 200
    assert resp.json()["total_units"] == 2


def test_stock_adjust_optimistic_concurrency(auth_client, make_product, add_stock):
    p = make_product(name="Mehl", package_size=10)
    out = add_stock(p["id"], size=10, remaining=10)
    stock_id = out["stock"][0]["id"]
    seen = out["stock"][0]["updated_at"]

    bumped = auth_client.patch(
        f"{auth_client.k}/products/{p['id']}/stock/{stock_id}", json={"remaining": 7}
    ).json()
    assert bumped["stock"][0]["updated_at"] != seen

    stale = auth_client.patch(
        f"{auth_client.k}/products/{p['id']}/stock/{stock_id}",
        json={"remaining": 3, "expected_updated_at": seen},
    )
    assert stale.status_code == 409

    ok = auth_client.patch(
        f"{auth_client.k}/products/{p['id']}/stock/{stock_id}",
        json={"remaining": 3, "expected_updated_at": bumped["stock"][0]["updated_at"]},
    )
    assert ok.status_code == 200
    assert ok.json()["stock"][0]["remaining"] == 3


def test_soft_delete_and_restore(auth_client, make_product):
    p = make_product(name="Butter")
    pid = p["id"]

    assert auth_client.delete(f"{auth_client.k}/products/{pid}").status_code == 204
    assert auth_client.get(f"{auth_client.k}/products/{pid}").status_code == 404
    assert auth_client.get(f"{auth_client.k}/products").json() == []
    assert any(
        x["id"] == pid for x in auth_client.get(f"{auth_client.k}/products?include_deleted=true").json()
    )

    restored = auth_client.post(f"{auth_client.k}/products/{pid}/restore")
    assert restored.status_code == 200
    assert auth_client.get(f"{auth_client.k}/products/{pid}").status_code == 200


def test_add_stock_returns_created_id(make_product, add_stock):
    """Offline clients map their optimistic temp package id to this."""
    p = make_product(name="Milch", package_size=1)
    first = add_stock(p["id"])
    assert first["created_stock_id"] in [s["id"] for s in first["stock"]]
    second = add_stock(p["id"])
    assert second["created_stock_id"] != first["created_stock_id"]


def test_add_stock_missing_product_404(auth_client):
    assert auth_client.post(f"{auth_client.k}/products/999/stock", json={}).status_code == 404
