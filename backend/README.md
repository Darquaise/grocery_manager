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

## Migrations (Alembic)

```bash
uv run alembic revision --autogenerate -m "init"
uv run alembic upgrade head
```

The schema is the SQLModel set in `app/models.py`. In production Alembic owns the
schema; the app additionally `create_all()`s on startup as a dev convenience.

## Layout

```
app/
  main.py        FastAPI app, SPA mount + SPA fallback
  config.py      pydantic-settings
  db.py          engine + session
  models.py      SQLModel tables (User, Category, Product, ShoppingListItem, ShoppingTrip)
  security.py    argon2 hashing
  seed.py        default categories + the two accounts
  api/           routers: auth, categories, products, shopping
migrations/      Alembic
```
