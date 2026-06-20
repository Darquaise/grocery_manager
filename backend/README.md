# grocery_manager — backend

FastAPI + SQLModel. Serves the JSON API under `/api` and, in the container, the
built Angular SPA from `static/` (one origin, no CORS).

## Dev

```bash
uv sync
uv run uvicorn app.main:app --reload     # http://127.0.0.1:8000
```

Needs a reachable Postgres via `DATABASE_URL`. Options:
- SSH-tunnel to the shared Postgres on ep3o:
  `ssh -L 5432:127.0.0.1:5432 ep3o` then use `…@localhost:5432/grocery`.
- Or a throwaway local DB: `docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:18`.

Config comes from env vars (see `../.env.example`): `DATABASE_URL`,
`SESSION_SECRET`, `USER1_*`, `USER2_*`.

## Tests

```bash
uv run pytest        # in-memory SQLite, no real DB needed
uv run ruff check .
```

## Migrations (Alembic)

The init migration already exists (`migrations/versions/*_init.py`) and is the
schema source of truth. Apply / regenerate:

```bash
uv run alembic upgrade head                         # apply
uv run alembic revision --autogenerate -m "msg"     # after model changes
```

In production Alembic owns the schema: the container runs `alembic upgrade head`
on start and `DB_AUTO_CREATE=false`. Locally `DB_AUTO_CREATE` defaults to true, so
the app `create_all()`s on startup as a dev convenience.

## Layout

```
app/
  main.py        FastAPI app, SPA mount + SPA fallback
  config.py      pydantic-settings
  db.py          engine + session
  models.py      SQLModel tables (User, Category, Product, ShoppingListItem, ShoppingTrip)
  security.py    argon2 hashing
  seed.py        default categories + the two accounts
  shopping_logic.py  auto shopping-list reconciliation + snooze lifecycle
  api/           routers: auth, users, categories, products, shopping
migrations/      Alembic (init revision present)
tests/           pytest (auth, products, auto-list, trips, categories/users)
```
