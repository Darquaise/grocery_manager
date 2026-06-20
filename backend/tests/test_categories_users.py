def test_default_categories_seeded(auth_client):
    cats = auth_client.get("/api/categories").json()
    names = [c["name"] for c in cats]
    assert "Gemüse" in names and "Sonstiges" in names
    assert all(c["is_default"] for c in cats)


def test_category_create_update_delete_reassigns_products(auth_client, make_product):
    created = auth_client.post("/api/categories", json={"name": "Snacks", "sort_order": 99})
    assert created.status_code == 201
    cat = created.json()
    assert cat["is_default"] is False

    renamed = auth_client.patch(f"/api/categories/{cat['id']}", json={"name": "Knabberei"})
    assert renamed.json()["name"] == "Knabberei"

    product = make_product(name="Chips", category_id=cat["id"])
    assert auth_client.delete(f"/api/categories/{cat['id']}").status_code == 204

    # Product survives, its category falls back to null.
    assert auth_client.get(f"/api/products/{product['id']}").json()["category_id"] is None


def test_list_users_and_update_color(auth_client):
    users = auth_client.get("/api/users").json()
    assert sorted(u["name"] for u in users) == ["alice", "bob"]

    resp = auth_client.patch("/api/users/me", json={"color": "#10b981"})
    assert resp.status_code == 200
    assert resp.json()["color"] == "#10b981"
    assert resp.json()["name"] == "alice"
