FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.10.9 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
ENV PATH="/app/.venv/bin:$PATH" ENV=prod PYTHONUNBUFFERED=1
# "::" listens on IPv4 and IPv6, which Railway's private network needs.
CMD ["sh", "-c", "alembic upgrade head && python serve.py"]
