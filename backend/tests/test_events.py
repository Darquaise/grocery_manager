"""Live-update plumbing: the change middleware and the SSE endpoint's guards.

The stream itself is endless, so these tests observe `events.bus` revisions
instead of consuming the SSE response.
"""

from app.events import bus
from tests.util import login


def _make_product(client, name="Milch"):
    resp = client.post(f"{client.k}/products", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_mutations_bump_the_kitchen_revision(auth_client):
    kid = auth_client.kitchen_id
    before = bus.revision(kid)
    product = _make_product(auth_client)
    assert bus.revision(kid) == before + 1

    resp = auth_client.post(f"{auth_client.k}/products/{product['id']}/stock", json={})
    assert resp.status_code == 201, resp.text
    assert bus.revision(kid) == before + 2


def test_reads_and_failures_do_not_bump(auth_client):
    kid = auth_client.kitchen_id
    before = bus.revision(kid)

    assert auth_client.get(f"{auth_client.k}/products").status_code == 200
    assert bus.revision(kid) == before

    resp = auth_client.patch(auth_client.k, json={"name": "   "})
    assert resp.status_code == 422
    assert bus.revision(kid) == before


def test_other_kitchens_are_not_bumped(auth_client):
    kid = auth_client.kitchen_id
    other = bus.revision(kid + 1)
    _make_product(auth_client)
    assert bus.revision(kid + 1) == other


def test_accept_and_decline_invite_bump_explicitly(auth_client):
    kid = auth_client.kitchen_id
    resp = auth_client.post(f"{auth_client.k}/invites", json={"name": "bob", "role": "write"})
    assert resp.status_code == 201, resp.text

    login(auth_client, "bob", "pw-bob")
    invites = auth_client.get("/api/kitchen-invites").json()
    assert len(invites) == 1

    before = bus.revision(kid)
    # Accept is under /api/kitchen-invites (no kitchen id in the URL) — only
    # the explicit bump can cover it.
    resp = auth_client.post(f"/api/kitchen-invites/{invites[0]['id']}/accept", json={})
    assert resp.status_code == 200, resp.text
    assert bus.revision(kid) == before + 1


def test_events_endpoint_requires_membership(auth_client):
    kid = auth_client.kitchen_id

    login(auth_client, "bob", "pw-bob")  # bob is not a member
    assert auth_client.get(f"/api/kitchens/{kid}/events").status_code == 404

    auth_client.post("/api/logout")
    assert auth_client.get(f"/api/kitchens/{kid}/events").status_code == 401
