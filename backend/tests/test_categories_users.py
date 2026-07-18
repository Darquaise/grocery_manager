def test_categories_start_empty(auth_client):
    assert auth_client.get(f"{auth_client.k}/categories").json() == []


def test_category_create_update_delete_reassigns_products(auth_client, make_product):
    created = auth_client.post(
        f"{auth_client.k}/categories", json={"name": "Snacks", "sort_order": 99}
    )
    assert created.status_code == 201
    cat = created.json()
    assert cat["is_default"] is False

    renamed = auth_client.patch(
        f"{auth_client.k}/categories/{cat['id']}", json={"name": "Knabberei"}
    )
    assert renamed.json()["name"] == "Knabberei"

    product = make_product(name="Chips", category_id=cat["id"])
    assert auth_client.delete(f"{auth_client.k}/categories/{cat['id']}").status_code == 204

    # Product survives, its category falls back to null.
    assert (
        auth_client.get(f"{auth_client.k}/products/{product['id']}").json()["category_id"] is None
    )


def test_product_rejects_foreign_category(auth_client, client):
    """A category from another kitchen cannot be referenced."""
    from tests.util import create_kitchen

    other = create_kitchen(auth_client, "Zweite Küche")
    cat = auth_client.post(
        f"/api/kitchens/{other['id']}/categories", json={"name": "Fremd"}
    ).json()
    resp = auth_client.post(
        f"{auth_client.k}/products",
        json={"name": "Chips", "package_size": 1, "category_id": cat["id"]},
    )
    assert resp.status_code == 422


def test_update_own_color(auth_client):
    resp = auth_client.patch("/api/users/me", json={"color": "#10b981"})
    assert resp.status_code == 200
    assert resp.json()["color"] == "#10b981"
    assert resp.json()["name"] == "alice"
