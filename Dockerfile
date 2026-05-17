FROM oven/bun:1.3 AS base

WORKDIR /app

# Python + venv for the scrapling adapter (Cloudflare-friendly HTTP fetcher)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /app/.venv \
    && /app/.venv/bin/pip install --no-cache-dir --upgrade pip \
    && /app/.venv/bin/pip install --no-cache-dir scrapling

# Bun deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Application code
COPY . .

ENV KMR_DB_PATH=/data/radio_cache.sqlite
ENV KMR_LIBRARY_PATH=/app/artists

RUN mkdir -p /data

EXPOSE 3000

CMD ["bun", "src/server.ts"]
