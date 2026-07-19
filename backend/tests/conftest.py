"""Test harness: a fresh in-memory SQLite DB per test, two seeded accounts, and
a logged-in client with its own kitchen. The app's engine is swapped for a
single shared-connection SQLite engine (StaticPool) so the TestClient's worker
threads see one DB."""

import os

# Must be set before app.config builds its Settings singleton.
os.environ.update(
    DATABASE_URL="sqlite://",
    SESSION_SECRET="test-secret",
    USER1_NAME="alice",
    USER1_PASSWORD="pw-alice",
    USER1_COLOR="#3b82f6",
    USER2_NAME="bob",
    USER2_PASSWORD="pw-bob",
    USER2_COLOR="#ef4444",
    # Blank the imprint details: a developer's own .env carries real values,
    # which would otherwise leak in and flip `configured` to true.
    LEGAL_NAME="",
    LEGAL_CARE_OF="",
    LEGAL_STREET="",
    LEGAL_CITY="",
    LEGAL_COUNTRY="",
    LEGAL_EMAIL="",
    LEGAL_VAT_ID="",
    LEGAL_HOSTING_PROVIDER="",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

import app.db  # noqa: E402
import app.main  # noqa: E402
from app.seed import seed  # noqa: E402
from tests.util import create_kitchen, login  # noqa: E402

_test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    echo=False,
)
# Point both the request session factory and the lifespan/seed at the test engine.
app.db.engine = _test_engine
app.main.engine = _test_engine


@pytest.fixture()
def client():
    SQLModel.metadata.drop_all(_test_engine)
    SQLModel.metadata.create_all(_test_engine)
    with Session(_test_engine) as session:
        seed(session)
    with TestClient(app.main.app) as test_client:
        yield test_client
    SQLModel.metadata.drop_all(_test_engine)


@pytest.fixture()
def auth_client(client):
    """`client`, logged in as alice (user 1), owning a fresh kitchen. The
    kitchen-scoped API prefix is exposed as `client.k`."""
    login(client, "alice", "pw-alice")
    kitchen = create_kitchen(client)
    client.kitchen_id = kitchen["id"]
    client.k = f"/api/kitchens/{kitchen['id']}"
    return client


@pytest.fixture()
def make_product(auth_client):
    """Factory: create a product via the API and return its JSON."""

    def _make(**overrides):
        body = {"name": "Test", "package_size": 1, "can_expire": "none"}
        body.update(overrides)
        resp = auth_client.post(f"{auth_client.k}/products", json=body)
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _make


@pytest.fixture()
def add_stock(auth_client):
    """Factory: add one stock package to a product and return the product JSON."""

    def _add(product_id, **kw):
        resp = auth_client.post(f"{auth_client.k}/products/{product_id}/stock", json=kw)
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _add
