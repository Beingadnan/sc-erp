# Builds the api or worker image:
#   docker build -f infrastructure/docker/node-app.Dockerfile --build-arg APP=api -t school-erp-api .
#   docker build -f infrastructure/docker/node-app.Dockerfile --build-arg APP=worker -t school-erp-worker .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG APP
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@school-erp/${APP}...
RUN pnpm --filter=@school-erp/${APP} deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out /app
USER app
CMD ["node", "dist/main.js"]
