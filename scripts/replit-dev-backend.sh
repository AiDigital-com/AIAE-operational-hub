#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/replit-env.sh
mvn -f backend/pom.xml -DskipTests -Dskip.frontend=true install
exec mvn -f backend/application/pom.xml -DskipTests -Dskip.frontend=true spring-boot:run
