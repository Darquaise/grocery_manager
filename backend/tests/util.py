"""Small API helpers shared by the test files.

Kept out of `conftest.py` on purpose: importing `tests.conftest` from a test
file would load the module a *second* time and re-run its engine patching.
"""


def login(client, name, password):
    resp = client.post("/api/login", json={"name": name, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()


def create_kitchen(client, name="Testküche"):
    """Create a kitchen as the logged-in user and return its JSON."""
    resp = client.post("/api/kitchens", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()
