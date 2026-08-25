FROM maven:3.9.9-eclipse-temurin-21

WORKDIR /workspace
COPY backend backend

RUN --mount=type=cache,target=/root/.m2 \
	mvn -f backend/pom.xml -pl db dependency:go-offline -B

ENTRYPOINT ["mvn", "-f", "backend/pom.xml", "-pl", "db", "liquibase:update", "-B"]
