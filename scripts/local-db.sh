#!/usr/bin/env bash
# Local PostgreSQL in Docker (backend/docker-compose.yml), plus the local admin seed.
#
#   bash scripts/local-db.sh          start the container, wait for the schema, seed the admin
#   bash scripts/local-db.sh up       start the container only
#   bash scripts/local-db.sh seed     seed the admin only (container must be running)
#   bash scripts/local-db.sh down     stop the container (data is kept in the oph-pgdata volume)
#
# The schema is created by the backend's Liquibase run on its first start (local profile), so on a
# fresh volume start this, then start the backend: the seed waits for the tables to appear.
#
# Admin identity comes from .env.local:
#   LOCAL_ADMIN_EMAIL=you@aidigital.com     required for the seed
#   LOCAL_ADMIN_NAME="Your Name"            optional (quote it: the file is sourced by bash)
#   LOCAL_ADMIN_CLERK_USER_ID=user_...      optional; without it the first login links by email
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

COMPOSE_FILE=backend/docker-compose.yml
CONTAINER=oph-postgres
DB_USER="${POSTGRES_USER:-oph}"
DB_NAME="${POSTGRES_DB:-oph}"
SCHEMA_WAIT_SECONDS="${LOCAL_DB_SCHEMA_WAIT_SECONDS:-300}"

psql_exec() {
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" "$@"
}

up() {
  docker compose -f "$COMPOSE_FILE" up -d postgres
  printf 'Waiting for %s to be healthy' "$CONTAINER"
  for _ in $(seq 1 60); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)" = "healthy" ]; then
      echo " ok"
      return 0
    fi
    printf '.'
    sleep 1
  done
  echo
  echo "$CONTAINER did not become healthy within 60s" >&2
  exit 1
}

schema_ready() {
  [ "$(psql_exec -tAc "select count(*) from information_schema.tables
        where table_schema = 'public'
          and table_name in ('hub_users', 'hub_roles', 'hub_scope_types', 'hub_role_assignments')")" = "4" ] \
    && [ "$(psql_exec -tAc "select count(*) from hub_roles where role_code = 'ADMIN'")" != "0" ]
}

seed() {
  if [ -z "${LOCAL_ADMIN_EMAIL:-}" ]; then
    echo "LOCAL_ADMIN_EMAIL is not set in .env.local; skipping the admin seed." >&2
    return 0
  fi
  if ! schema_ready; then
    echo "Schema not migrated yet. Start the backend (it runs Liquibase); waiting up to ${SCHEMA_WAIT_SECONDS}s..."
    local waited=0
    until schema_ready; do
      if [ "$waited" -ge "$SCHEMA_WAIT_SECONDS" ]; then
        echo "Schema still missing. Start the backend, then run: bash scripts/local-db.sh seed" >&2
        exit 1
      fi
      sleep 5
      waited=$((waited + 5))
    done
  fi
  echo "Seeding local admin ${LOCAL_ADMIN_EMAIL}"
  psql_exec \
    -v admin_email="$LOCAL_ADMIN_EMAIL" \
    -v admin_name="${LOCAL_ADMIN_NAME:-}" \
    -v admin_clerk_id="${LOCAL_ADMIN_CLERK_USER_ID:-}" \
    -f - < scripts/local-db-seed.sql
}

case "${1:-all}" in
  all) up; seed ;;
  up) up ;;
  seed) seed ;;
  down) docker compose -f "$COMPOSE_FILE" stop postgres ;;
  *) echo "usage: $0 [all|up|seed|down]" >&2; exit 2 ;;
esac
