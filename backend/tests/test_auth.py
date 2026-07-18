def test_protected_endpoint_requires_login(client):
    assert client.get("/api/kitchens").status_code == 401
    assert client.get("/api/kitchens/1/products").status_code == 401


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


# ── Registration (invite-only) ──────────────────────────────────────────────


def register(client, name, password, code):
    return client.post(
        "/api/register", json={"name": name, "password": password, "invite_code": code}
    )


def test_register_requires_valid_invite(client):
    assert register(client, "carol", "pw-carol", "nope").status_code == 403


def test_register_with_invite_and_reuse_blocked(client):
    from tests.util import login

    login(client, "alice", "pw-alice")
    code = client.post("/api/invites").json()["code"]
    client.post("/api/logout")

    resp = register(client, "carol", "pw-carol", code)
    assert resp.status_code == 201
    assert resp.json()["name"] == "carol"
    # Registration logs the new account in.
    assert client.get("/api/me").json()["name"] == "carol"
    # New accounts start without kitchens but may create their own.
    assert client.get("/api/kitchens").json() == []
    assert client.post("/api/kitchens", json={"name": "Carols Küche"}).status_code == 201

    # The code is single-use.
    client.post("/api/logout")
    assert register(client, "dave", "pw-dave", code).status_code == 403


def test_register_duplicate_name_conflicts(client):
    from tests.util import login

    login(client, "alice", "pw-alice")
    code = client.post("/api/invites").json()["code"]
    client.post("/api/logout")
    assert register(client, "alice", "pw-x", code).status_code == 409


def test_invite_list_and_revoke(client):
    from tests.util import login

    login(client, "alice", "pw-alice")
    invite = client.post("/api/invites").json()
    listed = client.get("/api/invites").json()
    assert [i["code"] for i in listed] == [invite["code"]]
    assert listed[0]["used_by_name"] is None

    assert client.delete(f"/api/invites/{invite['id']}").status_code == 204
    assert client.get("/api/invites").json() == []

    # Someone else's invite is invisible (bob can't revoke alice's).
    fresh = client.post("/api/invites").json()
    client.post("/api/logout")
    login(client, "bob", "pw-bob")
    assert client.delete(f"/api/invites/{fresh['id']}").status_code == 404


def test_kitchen_linked_code_creates_pending_invite(client):
    from tests.util import create_kitchen, login

    login(client, "alice", "pw-alice")
    kitchen = create_kitchen(client)
    invite = client.post(
        "/api/invites", json={"kitchen_id": kitchen["id"], "kitchen_role": "read"}
    ).json()
    assert invite["kitchen_name"] == "Testküche"
    assert invite["kitchen_role"] == "read"
    client.post("/api/logout")

    register(client, "carol", "pw-carol", invite["code"])
    # Not a member yet — a pending invitation awaits in the join dialog.
    assert client.get("/api/kitchens").json() == []
    my = client.get("/api/kitchen-invites").json()
    assert len(my) == 1
    assert my[0]["kitchen_id"] == kitchen["id"]
    assert my[0]["invited_by_name"] == "alice"
    joined = client.post(f"/api/kitchen-invites/{my[0]['id']}/accept").json()
    assert joined["my_role"] == "read"
    assert [k["id"] for k in client.get("/api/kitchens").json()] == [kitchen["id"]]


def test_attaching_kitchen_requires_admin(client):
    from tests.util import create_kitchen, login

    login(client, "alice", "pw-alice")
    kitchen = create_kitchen(client)
    client.post("/api/logout")
    # bob is no member of alice's kitchen → the kitchen stays invisible.
    login(client, "bob", "pw-bob")
    resp = client.post("/api/invites", json={"kitchen_id": kitchen["id"]})
    assert resp.status_code == 404
    # Plain codes (no kitchen attached) remain available to everyone.
    assert client.post("/api/invites").status_code == 201


def test_used_invite_shows_user_and_cannot_be_revoked(client):
    from tests.util import login

    login(client, "alice", "pw-alice")
    invite = client.post("/api/invites").json()
    client.post("/api/logout")
    register(client, "carol", "pw-carol", invite["code"])
    client.post("/api/logout")

    login(client, "alice", "pw-alice")
    listed = client.get("/api/invites").json()
    assert listed[0]["used_by_name"] == "carol"
    assert client.delete(f"/api/invites/{invite['id']}").status_code == 409
