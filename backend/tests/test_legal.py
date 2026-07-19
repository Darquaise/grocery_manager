"""The imprint/privacy provider details come from the environment so that
self-hosters publish their own data instead of ours."""

from app.config import settings


def test_legal_is_public(client):
    """No login: an imprint has to be reachable without an account."""
    resp = client.get("/api/legal")
    assert resp.status_code == 200, resp.text


def test_unconfigured_instance_reports_not_configured(client):
    """The test env sets no LEGAL_* vars — the frontend hides the link on this."""
    body = client.get("/api/legal").json()
    assert body["configured"] is False
    assert body["name"] == ""


def test_configured_when_name_and_address_are_set(client, monkeypatch):
    monkeypatch.setattr(settings, "legal_name", "Erika Mustermann")
    monkeypatch.setattr(settings, "legal_street", "Musterweg 1")
    monkeypatch.setattr(settings, "legal_city", "12345 Musterstadt")

    body = client.get("/api/legal").json()
    assert body["configured"] is True
    assert body["name"] == "Erika Mustermann"


def test_name_without_address_stays_unconfigured(client, monkeypatch):
    """A name alone is not a ladungsfähige Anschrift, so it must not count."""
    monkeypatch.setattr(settings, "legal_name", "Erika Mustermann")

    assert client.get("/api/legal").json()["configured"] is False
