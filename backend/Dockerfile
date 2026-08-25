FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY backend backend
RUN --mount=type=cache,target=/root/.m2 \
	mvn -f backend/pom.xml -pl application -am package -B \
	-Dmaven.test.skip=true

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

ENV PORT=5000
ENV JAVA_TOOL_OPTIONS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"
COPY --from=build /workspace/backend/application/target/*.jar /app/application.jar
USER app
EXPOSE 5000
ENTRYPOINT ["java", "-jar", "/app/application.jar"]
