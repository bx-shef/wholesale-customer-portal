# Один образ: Nitro отдаёт страницы ЛК, /api и /mcp/* (docs/DEPLOY.md). Конфигурация — только
# окружением при запуске (.env.example), поэтому образ годится для стенда и для ВМ клиента.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NITRO_HOST=0.0.0.0
# Файлы — пользователю node. Базу справки Nuxt Content пишет при старте в /tmp
# (nuxt.config.ts → content.database): в проде контейнер read_only, /tmp — tmpfs.
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
LABEL org.opencontainers.image.source=https://github.com/bx-shef/wholesale-customer-portal
# Коммит сборки для GET /api/health. Задаёт джоба deploy в CI; стоит последним — меняется на
# каждом коммите и не сбивает кэш слоёв.
ARG COMMIT_SHA=""
ENV COMMIT_SHA=$COMMIT_SHA
CMD ["node", ".output/server/index.mjs"]
