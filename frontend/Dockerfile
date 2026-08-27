# Frontend Dockerfile - local development and handoff only.
#
# Build context is the REPO ROOT (set in docker-compose.yml as `context: .`).

FROM node:22-bookworm-slim AS build
WORKDIR /workspace/frontend
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV VITE_CLERK_JWT_TEMPLATE=aidigital-api
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY frontend/ ./
COPY backend/application/src/main/resources/api/v1/specs/openapi.yaml \
     /workspace/backend/application/src/main/resources/api/v1/specs/openapi.yaml
RUN test -n "${VITE_CLERK_PUBLISHABLE_KEY}" \
  || (echo "VITE_CLERK_PUBLISHABLE_KEY build arg is required for Docker frontend build" >&2 && exit 1)
RUN npm run generate:api && npm run build

FROM nginx:1.27-alpine
ENV APP_CONTEXT_PATH=
COPY --from=build /workspace/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
