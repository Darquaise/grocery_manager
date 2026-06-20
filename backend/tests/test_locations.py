def test_default_locations_seeded(auth_client):
    locs = auth_client.get("/api/locations").json()
    names = [loc["name"] for loc in locs]
    assert "Kühlschrank" in names and "Tiefkühler" in names
    assert all(loc["is_default"] for loc in locs)


def test_location_create_update_delete_reassigns_products(auth_client, make_product):
    created = auth_client.post("/api/locations", json={"name": "Keller", "sort_order": 99})
    assert created.status_code == 201
    loc = created.json()
    assert loc["is_default"] is False

    renamed = auth_client.patch(f"/api/locations/{loc['id']}", json={"name": "Vorratskeller"})
    assert renamed.json()["name"] == "Vorratskeller"

    product = make_product(name="Kartoffeln", location_id=loc["id"])
    assert auth_client.delete(f"/api/locations/{loc['id']}").status_code == 204

    # Product survives, its location falls back to null.
    assert auth_client.get(f"/api/products/{product['id']}").json()["location_id"] is None
