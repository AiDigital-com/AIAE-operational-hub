#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

export SPRING_PROFILES_ACTIVE="${SPRING_PROFILES_ACTIVE:-local}"
export PORT="${PORT:-5000}"

if command -v /usr/libexec/java_home >/dev/null 2>&1; then
  JAVA_21_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
  if [ -n "$JAVA_21_HOME" ]; then
    export JAVA_HOME="$JAVA_21_HOME"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
fi

mvn -f backend/pom.xml -DskipTests -Dskip.frontend=true install
exec mvn -f backend/application/pom.xml -DskipTests -Dskip.frontend=true spring-boot:run
