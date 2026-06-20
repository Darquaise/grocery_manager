# Multi-stage: build the Angular SPA, then serve it (and the API) from FastAPI.

# ── Stage 1: build the Angular frontend ───────────────────────────────────────
FROM node:24-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ───────────────────────────────────────────────────
FROM python:3.14-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    PATH="/app/.venv/bin:$PATH"

# Install dependencies first for layer caching.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --no-dev --frozen

# App code + the built SPA (Angular emits dist/<project>/browser).
COPY backend/ ./
COPY --from=frontend /fe/dist/ /tmp/dist/
RUN set -eux; \
    src="$(find /tmp/dist -name index.html -printf '%h\n' | head -1)"; \
    mkdir -p /app/static; \
    cp -a "$src"/. /app/static/; \
    rm -rf /tmp/dist

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
