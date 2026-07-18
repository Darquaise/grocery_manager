"""Kitchens: membership, invitations, roles, isolation, ownership transfer
and deletion."""

from tests.util import create_kitchen, login


def invite(client, kitchen_id, name, role):
    return client.post(f"/api/kitchens/{kitchen_id}/invites", json={"name": name, "role": role})


def add_member(client, kitchen_id, name, role):
    """Invite `name` and accept as them; the client ends up logged in as the
    user it started with (alice/bob per fixture convention `pw-<name>`)."""
    me = client.get("/api/me").json()["name"]
    resp = invite(client, kitchen_id, name, role)
    if resp.status_code != 201:
        return resp
    client.post("/api/logout")
    login(client, name, f"pw-{name}")
    pending = client.get("/api/kitchen-invites").json()
    my = next(i for i in pending if i["kitchen_id"] == kitchen_id)
    assert client.post(f"/api/kitchen-invites/{my['id']}/accept").status_code == 200
    client.post("/api/logout")
    login(client, me, f"pw-{me}")
    return resp


def as_bob(client):
    client.post("/api/logout")
    login(client, "bob", "pw-bob")


def as_alice(client):
    client.post("/api/logout")
    login(client, "alice", "pw-alice")


def test_create_and_list_kitchens(auth_client):
    kitchens = auth_client.get("/api/kitchens").json()
    assert len(kitchens) == 1
    assert kitchens[0]["name"] == "Testküche"
    assert kitchens[0]["my_role"] == "admin"
    assert kitchens[0]["is_owner"] is True

    create_kitchen(auth_client, "Zweitküche")
    assert len(auth_client.get("/api/kitchens").json()) == 2


def test_non_member_sees_nothing(auth_client):
    kid = auth_client.kitchen_id
    as_bob(auth_client)
    assert auth_client.get("/api/kitchens").json() == []
    # Kitchen existence stays hidden from non-members.
    assert auth_client.get(f"/api/kitchens/{kid}/products").status_code == 404
    assert auth_client.get(f"/api/kitchens/{kid}/members").status_code == 404


def test_kitchen_isolation(auth_client, make_product):
    """Data in one kitchen is invisible in another."""
    make_product(name="Milch")
    other = create_kitchen(auth_client, "Zweitküche")
    assert auth_client.get(f"/api/kitchens/{other['id']}/products").json() == []
    assert auth_client.get(f"{auth_client.k}/products").json() != []


def test_read_role_can_read_but_not_write(auth_client, make_product):
    make_product(name="Milch")
    kid = auth_client.kitchen_id
    assert add_member(auth_client, kid, "bob", "read").status_code == 201

    as_bob(auth_client)
    products = auth_client.get(f"/api/kitchens/{kid}/products").json()
    assert [p["name"] for p in products] == ["Milch"]
    assert auth_client.get(f"/api/kitchens/{kid}/shopping/items").status_code == 200

    body = {"name": "Neu", "package_size": 1}
    assert auth_client.post(f"/api/kitchens/{kid}/products", json=body).status_code == 403
    assert (
        auth_client.post(
            f"/api/kitchens/{kid}/shopping/items", json={"display_name": "X"}
        ).status_code
        == 403
    )
    assert (
        auth_client.post(f"/api/kitchens/{kid}/categories", json={"name": "X"}).status_code == 403
    )
    # No admin actions either.
    assert (
        auth_client.patch(f"/api/kitchens/{kid}", json={"name": "Gekapert"}).status_code == 403
    )


def test_write_role_can_change_data_but_not_manage(auth_client):
    kid = auth_client.kitchen_id
    add_member(auth_client, kid, "bob", "write")

    as_bob(auth_client)
    body = {"name": "Milch", "package_size": 1}
    assert auth_client.post(f"/api/kitchens/{kid}/products", json=body).status_code == 201
    assert (
        auth_client.post(f"/api/kitchens/{kid}/categories", json={"name": "X"}).status_code == 201
    )
    assert auth_client.patch(f"/api/kitchens/{kid}", json={"name": "Neu"}).status_code == 403
    assert add_member(auth_client, kid, "carol", "read").status_code == 403


def test_admin_role_manages_kitchen(auth_client):
    kid = auth_client.kitchen_id
    add_member(auth_client, kid, "bob", "admin")
    members = auth_client.get(f"/api/kitchens/{kid}/members").json()
    alice_id = next(m["user_id"] for m in members if m["name"] == "alice")

    as_bob(auth_client)
    assert auth_client.patch(f"/api/kitchens/{kid}", json={"name": "Umbenannt"}).status_code == 200
    # Admins manage members — but the owner stays untouchable.
    assert (
        auth_client.patch(
            f"/api/kitchens/{kid}/members/{alice_id}", json={"role": "read"}
        ).status_code
        == 409
    )
    assert auth_client.delete(f"/api/kitchens/{kid}/members/{alice_id}").status_code == 409


def test_member_roles_and_removal(auth_client):
    kid = auth_client.kitchen_id
    add_member(auth_client, kid, "bob", "read")

    members = auth_client.get(f"/api/kitchens/{kid}/members").json()
    by_name = {m["name"]: m for m in members}
    assert by_name["alice"]["is_owner"] is True
    assert by_name["alice"]["role"] == "admin"
    assert by_name["bob"]["role"] == "read"
    bob_id = by_name["bob"]["user_id"]

    # Upgrade bob, then remove him.
    resp = auth_client.patch(f"/api/kitchens/{kid}/members/{bob_id}", json={"role": "write"})
    assert resp.status_code == 200
    assert {m["name"]: m["role"] for m in resp.json()}["bob"] == "write"
    assert auth_client.delete(f"/api/kitchens/{kid}/members/{bob_id}").status_code == 204
    assert add_member(auth_client, kid, "bob", "read").status_code == 201  # re-invitable

    # Owner cannot be demoted or removed.
    owner_id = by_name["alice"]["user_id"]
    assert (
        auth_client.patch(
            f"/api/kitchens/{kid}/members/{owner_id}", json={"role": "read"}
        ).status_code
        == 409
    )
    assert auth_client.delete(f"/api/kitchens/{kid}/members/{owner_id}").status_code == 409


def test_member_can_leave(auth_client):
    kid = auth_client.kitchen_id
    add_member(auth_client, kid, "bob", "read")
    members = auth_client.get(f"/api/kitchens/{kid}/members").json()
    bob_id = next(m["user_id"] for m in members if m["name"] == "bob")

    as_bob(auth_client)
    assert auth_client.delete(f"/api/kitchens/{kid}/members/{bob_id}").status_code == 204
    assert auth_client.get(f"/api/kitchens/{kid}/members").status_code == 404  # no longer member


def test_unknown_or_duplicate_member(auth_client):
    kid = auth_client.kitchen_id
    assert add_member(auth_client, kid, "nobody", "read").status_code == 404
    add_member(auth_client, kid, "bob", "read")
    assert add_member(auth_client, kid, "bob", "write").status_code == 409  # already member
    assert invite(auth_client, kid, "bob", "write").status_code == 409


# ── Invitations (pending until accepted) ────────────────────────────────────


def test_invite_flow_accept(auth_client):
    kid = auth_client.kitchen_id
    assert invite(auth_client, kid, "bob", "write").status_code == 201
    assert invite(auth_client, kid, "bob", "read").status_code == 409  # already invited
    # Pending, not yet a member.
    pending = auth_client.get(f"/api/kitchens/{kid}/invites").json()
    assert [(p["name"], p["role"]) for p in pending] == [("bob", "write")]
    assert len(auth_client.get(f"/api/kitchens/{kid}/members").json()) == 1

    as_bob(auth_client)
    # Not a member yet — no kitchen access.
    assert auth_client.get(f"/api/kitchens/{kid}/products").status_code == 404
    my = auth_client.get("/api/kitchen-invites").json()
    assert len(my) == 1
    assert my[0]["kitchen_name"] == "Testküche"
    assert my[0]["invited_by_name"] == "alice"
    assert my[0]["role"] == "write"

    joined = auth_client.post(f"/api/kitchen-invites/{my[0]['id']}/accept").json()
    assert joined["id"] == kid and joined["my_role"] == "write"
    assert auth_client.get(f"/api/kitchens/{kid}/products").status_code == 200
    assert auth_client.get("/api/kitchen-invites").json() == []

    as_alice(auth_client)
    assert auth_client.get(f"/api/kitchens/{kid}/invites").json() == []
    assert len(auth_client.get(f"/api/kitchens/{kid}/members").json()) == 2


def test_invite_decline(auth_client):
    kid = auth_client.kitchen_id
    invite(auth_client, kid, "bob", "read")
    as_bob(auth_client)
    my = auth_client.get("/api/kitchen-invites").json()
    assert auth_client.delete(f"/api/kitchen-invites/{my[0]['id']}").status_code == 204
    assert auth_client.get("/api/kitchen-invites").json() == []
    assert auth_client.get(f"/api/kitchens/{kid}/products").status_code == 404
    # Declining frees the slot — the admin may invite again.
    as_alice(auth_client)
    assert invite(auth_client, kid, "bob", "read").status_code == 201


def test_invite_revoke_by_admin(auth_client):
    kid = auth_client.kitchen_id
    invite(auth_client, kid, "bob", "read")
    pending = auth_client.get(f"/api/kitchens/{kid}/invites").json()
    assert auth_client.delete(f"/api/kitchens/{kid}/invites/{pending[0]['id']}").status_code == 204
    as_bob(auth_client)
    assert auth_client.get("/api/kitchen-invites").json() == []


def test_invite_requires_admin(auth_client):
    kid = auth_client.kitchen_id
    add_member(auth_client, kid, "bob", "write")
    as_bob(auth_client)
    assert invite(auth_client, kid, "carol", "read").status_code == 403
    assert auth_client.get(f"/api/kitchens/{kid}/invites").status_code == 403


def test_foreign_invite_is_invisible(auth_client):
    """Others can neither accept nor decline an invitation addressed to bob."""
    kid = auth_client.kitchen_id
    invite(auth_client, kid, "bob", "read")
    as_bob(auth_client)
    invite_id = auth_client.get("/api/kitchen-invites").json()[0]["id"]
    as_alice(auth_client)
    assert auth_client.post(f"/api/kitchen-invites/{invite_id}/accept").status_code == 404
    assert auth_client.delete(f"/api/kitchen-invites/{invite_id}").status_code == 404


# ── Deletion (owner only) ───────────────────────────────────────────────────


def test_owner_deletes_kitchen_with_all_data(auth_client, make_product, add_stock):
    kid = auth_client.kitchen_id
    p = make_product(name="Milch", reorder_status_level=1, reorder_refill_count=0)
    add_stock(p["id"])
    auth_client.post(f"{auth_client.k}/categories", json={"name": "Kat"})
    auth_client.post(f"{auth_client.k}/shopping/items", json={"display_name": "Brot"})
    add_member(auth_client, kid, "bob", "read")
    invite_code = auth_client.post("/api/invites", json={"kitchen_id": kid}).json()

    assert auth_client.delete(f"/api/kitchens/{kid}").status_code == 204
    assert auth_client.get("/api/kitchens").json() == []
    assert auth_client.get(f"/api/kitchens/{kid}/products").status_code == 404
    # The kitchen-linked registration code survives as a plain code.
    codes = auth_client.get("/api/invites").json()
    assert codes[0]["id"] == invite_code["id"] and codes[0]["kitchen_id"] is None

    as_bob(auth_client)
    assert auth_client.get("/api/kitchens").json() == []


def test_non_owner_cannot_delete_kitchen(auth_client):
    kid = auth_client.kitchen_id
    add_member(auth_client, kid, "bob", "admin")
    as_bob(auth_client)
    assert auth_client.delete(f"/api/kitchens/{kid}").status_code == 403
    as_alice(auth_client)
    assert len(auth_client.get("/api/kitchens").json()) == 1


def test_transfer_ownership(auth_client):
    kid = auth_client.kitchen_id
    add_member(auth_client, kid, "bob", "read")
    members = auth_client.get(f"/api/kitchens/{kid}/members").json()
    bob_id = next(m["user_id"] for m in members if m["name"] == "bob")
    alice_id = next(m["user_id"] for m in members if m["name"] == "alice")

    # Non-owner cannot transfer.
    as_bob(auth_client)
    assert (
        auth_client.post(
            f"/api/kitchens/{kid}/transfer", json={"user_id": bob_id}
        ).status_code
        == 403
    )

    as_alice(auth_client)
    resp = auth_client.post(f"/api/kitchens/{kid}/transfer", json={"user_id": bob_id})
    assert resp.status_code == 200
    by_name = {m["name"]: m for m in resp.json()}
    # New owner is bob (admin); alice stays on as admin member.
    assert by_name["bob"]["is_owner"] is True
    assert by_name["bob"]["role"] == "admin"
    assert by_name["alice"]["is_owner"] is False
    assert by_name["alice"]["role"] == "admin"

    kitchen = next(k for k in auth_client.get("/api/kitchens").json() if k["id"] == kid)
    assert kitchen["is_owner"] is False

    # The old owner can now be demoted/removed; the new owner can transfer back.
    as_bob(auth_client)
    assert (
        auth_client.post(
            f"/api/kitchens/{kid}/transfer", json={"user_id": alice_id}
        ).status_code
        == 200
    )


def test_transfer_to_non_member_fails(auth_client):
    kid = auth_client.kitchen_id
    assert (
        auth_client.post(f"/api/kitchens/{kid}/transfer", json={"user_id": 999}).status_code
        == 404
    )
    # Transferring to oneself is rejected too.
    members = auth_client.get(f"/api/kitchens/{kid}/members").json()
    alice_id = next(m["user_id"] for m in members if m["name"] == "alice")
    assert (
        auth_client.post(
            f"/api/kitchens/{kid}/transfer", json={"user_id": alice_id}
        ).status_code
        == 409
    )
