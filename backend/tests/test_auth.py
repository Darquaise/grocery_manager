def test_protected_endpoint_requires_login(client):
    assert client.get("/api/products").status_code == 401


def test_login_wrong_password(client):
    resp = client.post("/api/login", json={"name": "alice", "password": "nope"})
    assert resp.status_code == 401


def test_login_logout_flow(client):
    login = client.post("/api/login", json={"name": "alice", "password": "pw-alice"})
    assert login.status_code == 200
    assert login.json()["name"] == "alice"

    me = client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["name"] == "alice"

    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/me").status_code == 401


def test_health_is_public(client):
    assert client.get("/api/health").json() == {"status": "ok"}
