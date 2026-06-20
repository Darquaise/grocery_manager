"""Test harness: a fresh in-memory SQLite DB per test, two seeded accounts, and
a logged-in client. The app's engine is swapped for a single shared-connection
SQLite engine (StaticPool) so the TestClient's worker threads see one DB."""

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
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

import app.db  # noqa: E402
import app.main  # noqa: E402
from app.seed import seed  # noqa: E402

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
    """`client`, logged in as alice (user 1)."""
    resp = client.post("/api/login", json={"name": "alice", "password": "pw-alice"})
    assert resp.status_code == 200, resp.text
    return client


@pytest.fixture()
def make_product(auth_client):
    """Factory: create a product via the API and return its JSON."""

    def _make(**overrides):
        body = {"name": "Test", "tracking_type": "status", "current_value": 2}
        body.update(overrides)
        resp = auth_client.post("/api/products", json=body)
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _make

