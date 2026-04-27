#!/bin/bash
# Bring up the PostgreSQL container, starting Docker Desktop first if needed.
# Idempotent: safe to run when already up.

set -e
export PATH="/usr/local/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/docker/docker-compose.dev.yml"

# Check if Docker daemon is responsive
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon not running — launching Docker Desktop..."
  open -a Docker

  # Wait up to 60s for the daemon to come up
  for i in {1..60}; do
    if docker info >/dev/null 2>&1; then
      echo "Docker daemon ready."
      break
    fi
    if [ $i -eq 60 ]; then
      echo "ERROR: Docker daemon did not start within 60 seconds."
      exit 1
    fi
    sleep 1
  done
fi

# Already running? Skip.
if docker ps --filter "name=ai-studio-db" --filter "status=running" --format '{{.Names}}' | grep -q ai-studio-db; then
  echo "ai-studio-db container already running."
  exit 0
fi

echo "Starting ai-studio-db container..."
docker compose -f "$COMPOSE_FILE" up -d

# Wait for healthcheck to pass
for i in {1..30}; do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' ai-studio-db 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    echo "PostgreSQL is healthy."
    exit 0
  fi
  sleep 1
done

echo "WARNING: PostgreSQL did not become healthy within 30s. Check 'npm run db:logs'."
