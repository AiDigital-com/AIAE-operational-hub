#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/replit-env.sh
mvn -f backend/pom.xml test
cd frontend
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm run generate:api
npm run typecheck
npm run build
