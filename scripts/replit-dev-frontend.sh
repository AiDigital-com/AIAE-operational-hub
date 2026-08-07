#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/replit-env.sh
cd frontend
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run generate:api
exec npm run dev -- --host 0.0.0.0 --port 5173
