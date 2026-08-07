#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Swap in the published-app values before Maven runs: the SPA bakes
# CLERK_PUBLISHABLE_KEY into the bundle at build time (vite.config.ts
# `define`), so a runtime-only override would be too late.
if [ -f scripts/lib/deploy-env.sh ]; then
  # shellcheck source=lib/deploy-env.sh
  . scripts/lib/deploy-env.sh
fi

source scripts/replit-env.sh

cd frontend
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run generate:api
test -n "${VITE_CLERK_PUBLISHABLE_KEY:-}" || {
  echo "ERROR: VITE_CLERK_PUBLISHABLE_KEY or CLERK_PUBLISHABLE_KEY must be available during frontend build." >&2
  exit 1
}
npm run build
cd ..

STATIC_DIR="backend/application/src/main/resources/static"
test -f "${STATIC_DIR}/index.html" || {
  echo "ERROR: frontend build did not produce ${STATIC_DIR}/index.html." >&2
  exit 1
}

mvn -f backend/pom.xml -B -DskipTests -Dskip.frontend=true package

JAR="$(find backend/application/target -maxdepth 1 -name '*.jar' ! -name '*.original' | head -n 1)"
if [ -z "${JAR}" ]; then
  echo "ERROR: no Spring Boot jar produced in backend/application/target." >&2
  exit 1
fi
rm -rf backend/application/target/extracted
java -Djarmode=tools -jar "${JAR}" extract --destination backend/application/target/extracted || true
