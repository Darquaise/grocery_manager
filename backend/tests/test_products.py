def test_create_list_get(auth_client, make_product):
    created = make_product(name="Tomaten", tracking_type="counter", current_value=3)
    assert created["id"] > 0
    assert created["name"] == "Tomaten"

    listing = auth_client.get("/api/products").json()
    assert [p["name"] for p in listing] == ["Tomaten"]

    one = auth_client.get(f"/api/products/{created['id']}").json()
    assert one["current_value"] == 3


def test_update_product(auth_client, make_product):
    p = make_product(name="Milch", tracking_type="amount", unit="ml", current_value=1000)
    resp = auth_client.patch(f"/api/products/{p['id']}", json={"name": "Hafermilch", "notes": "bio"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Hafermilch"
    assert body["notes"] == "bio"
    assert body["unit"] == "ml"  # untouched fields stay


def test_adjust_changes_value(auth_client, make_product):
    p = make_product(name="Eier", tracking_type="counter", current_value=10)
    resp = auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 4})
    assert resp.status_code == 200
    assert resp.json()["current_value"] == 4


def test_adjust_optimistic_concurrency(auth_client, make_product):
    p = make_product(name="Mehl", tracking_type="counter", current_value=10)
    seen = p["updated_at"]

    # A concurrent change moves updated_at forward.
    bumped = auth_client.post(f"/api/products/{p['id']}/adjust", json={"current_value": 7}).json()
    assert bumped["updated_at"] != seen

    # Adjusting against the stale timestamp is rejected with the current state.
    stale = auth_client.post(
        f"/api/products/{p['id']}/adjust",
        json={"current_value": 3, "expected_updated_at": seen},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["current_value"] == 7

    # Adjusting against the current timestamp succeeds.
    ok = auth_client.post(
        f"/api/products/{p['id']}/adjust",
        json={"current_value": 3, "expected_updated_at": bumped["updated_at"]},
    )
    assert ok.status_code == 200
    assert ok.json()["current_value"] == 3


def test_soft_delete_and_restore(auth_client, make_product):
    p = make_product(name="Butter")
    pid = p["id"]

    assert auth_client.delete(f"/api/products/{pid}").status_code == 204
    assert auth_client.get(f"/api/products/{pid}").status_code == 404
    assert auth_client.get("/api/products").json() == []
    # Still visible with include_deleted.
    assert any(x["id"] == pid for x in auth_client.get("/api/products?include_deleted=true").json())

    restored = auth_client.post(f"/api/products/{pid}/restore")
    assert restored.status_code == 200
    assert auth_client.get(f"/api/products/{pid}").status_code == 200


def test_adjust_missing_product_404(auth_client):
    assert auth_client.post("/api/products/999/adjust", json={"current_value": 1}).status_code == 404
