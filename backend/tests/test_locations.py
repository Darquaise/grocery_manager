def test_locations_start_empty(auth_client):
    assert auth_client.get(f"{auth_client.k}/locations").json() == []


def test_location_create_update_delete_reassigns_products(auth_client, make_product):
    created = auth_client.post(
        f"{auth_client.k}/locations", json={"name": "Keller", "sort_order": 99}
    )
    assert created.status_code == 201
    loc = created.json()
    assert loc["is_default"] is False

    renamed = auth_client.patch(
        f"{auth_client.k}/locations/{loc['id']}", json={"name": "Vorratskeller"}
    )
    assert renamed.json()["name"] == "Vorratskeller"

    product = make_product(name="Kartoffeln", location_id=loc["id"])
    assert auth_client.delete(f"{auth_client.k}/locations/{loc['id']}").status_code == 204

    # Product survives, its location falls back to null.
    assert (
        auth_client.get(f"{auth_client.k}/products/{product['id']}").json()["location_id"] is None
    )
