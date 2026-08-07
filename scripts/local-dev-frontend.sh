#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

cd frontend

if [ ! -d node_moвщсdules ]; then
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
fi

npm run generate:api
exec npm run dev -- --host 0.0.0.0 --port 5173
