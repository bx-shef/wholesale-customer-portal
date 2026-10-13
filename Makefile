# ЛК. Один Makefile на два места: корень репозитория и каталог на сервере, где лежат только
# docker-compose.prod.yml, этот Makefile и .env (docs/DEPLOY.md). Схема — bx-shef/skills-site и
# bx-shef/invoice-from-tasks. На ВМ Битрикс24 рядом лежит docker-compose.bitrixvm.yml — make
# подключает его сам (docs/DEPLOY_BITRIXVM.md).

.DEFAULT_GOAL := help
.PHONY: help build-local prod-up prod-down prod-pull prod-redeploy logs ps health doctor self-update b24-setup

# Прод-переменные — только из .env: экспортированный соседним проектом DOMAIN на общем хосте
# не должен увести ЛК на чужой адрес. COMPOSE_PROJECT_NAME / COMPOSE_FILE хоста тоже снимаем.
override COMPOSE = env -u DOMAIN -u LETSENCRYPT_EMAIL -u COMPOSE_PROJECT_NAME -u COMPOSE_FILE \
	docker compose -f docker-compose.prod.yml $(if $(wildcard docker-compose.bitrixvm.yml),-f docker-compose.bitrixvm.yml)
override CONTAINER := wholesale-customer-portal
override RAW := https://raw.githubusercontent.com/bx-shef/wholesale-customer-portal/main
override IMAGE_SOURCE := https://github.com/bx-shef/wholesale-customer-portal
override HEALTH := fetch('http://127.0.0.1:3000/api/health').then(r => r.json()).then(j => { console.log(JSON.stringify(j)); process.exit(j.status === 'ok' ? 0 : 1) }, () => process.exit(1))

## Собрать из исходников и запустить на 127.0.0.1:3000
build-local:
	docker compose up --build

## Запустить / обновить контейнер
prod-up:
	$(COMPOSE) up -d

## Остановить
prod-down:
	$(COMPOSE) down

## Скачать свежий образ, не перезапуская контейнер
prod-pull:
	$(COMPOSE) pull

## Обновить прямо сейчас, не дожидаясь Watchtower (чистит только свои старые образы)
prod-redeploy:
	$(COMPOSE) pull && $(COMPOSE) up -d && \
	docker image prune -f --filter "label=org.opencontainers.image.source=$(IMAGE_SOURCE)"

## Живой лог (Ctrl+C — выйти)
logs:
	$(COMPOSE) logs -f app

## Состояние контейнера
ps:
	$(COMPOSE) ps

## Что задано и какая сборка запущена (GET /api/health изнутри контейнера)
health:
	@for i in $$(seq 1 30); do docker exec $(CONTAINER) node -e "$(HEALTH)" >/dev/null 2>&1 && break; sleep 1; done
	docker exec $(CONTAINER) node -e "$(HEALTH)"

## Что ЛК не хватает в CRM (только показать); записать — APPLY=1 make b24-setup
b24-setup:
	docker exec $(CONTAINER) node .output/b24-setup.mjs $$( [ -n "$${APPLY:-}" ] && echo --apply )

## Что не так: сеть, прокси, Watchtower, .env, контейнер
doctor:
	@docker network inspect proxy-net >/dev/null 2>&1 && echo "[ok] сеть proxy-net" || echo "[!!] нет сети proxy-net — docker network create proxy-net (docs/DEPLOY.md)"
	@if [ -f docker-compose.bitrixvm.yml ]; then \
		echo "[ok] ВМ Битрикс24: TLS у nginx ВМ, обновление — make self-update && make prod-redeploy"; \
		curl -fsS -o /dev/null http://127.0.0.1:$${APP_BIND_PORT:-3000}/api/health && echo "[ok] контейнер отвечает на 127.0.0.1" || echo "[!!] нет ответа на 127.0.0.1 — make logs"; \
	else \
		docker ps --format '{{.Names}}' | grep -qx nginx-proxy && echo "[ok] nginx-proxy" || echo "[!!] контейнер nginx-proxy не запущен"; \
		docker ps --format '{{.Names}}' | grep -qi watchtower && echo "[ok] watchtower" || echo "[..] watchtower не найден — обновлять через make prod-redeploy"; \
	fi
	@test -f .env && echo "[ok] .env" || echo "[!!] нет .env — шаблон .env.example"
	@for v in DOMAIN B24_WEBHOOK_URL SESSION_SECRET MCP_ADMIN_TOKEN; do grep -qE "^$$v=.+" .env 2>/dev/null && echo "[ok] $$v задан" || echo "[!!] $$v пуст"; done
	@grep -qE '^ONEC_MOCK=false' .env 2>/dev/null && echo "[ok] 1С: реальная база" || echo "[..] 1С: мок (ONEC_MOCK не false)"
	@$(COMPOSE) ps --format '{{.Name}} {{.Status}}' 2>/dev/null || true

## Обновить docker-compose.prod.yml и Makefile из main (для каталога на сервере)
self-update:
	curl -fsSL $(RAW)/docker-compose.prod.yml -o docker-compose.prod.yml.new && mv docker-compose.prod.yml.new docker-compose.prod.yml
	curl -fsSL $(RAW)/Makefile -o Makefile.new && mv Makefile.new Makefile
	@if [ -f docker-compose.bitrixvm.yml ]; then curl -fsSL $(RAW)/deploy/bitrixvm/docker-compose.bitrixvm.yml -o docker-compose.bitrixvm.yml.new && mv docker-compose.bitrixvm.yml.new docker-compose.bitrixvm.yml; fi
	@echo "обновлено; make prod-up"

## Эта справка
help:
	@grep -B1 -E '^[a-z-]+:' $(MAKEFILE_LIST) | grep -E '^##|^[a-z-]+:' | sed 's/^## //' | paste - - | awk -F'\t' '{ printf "  %-16s %s\n", $$2, $$1 }' | sed 's/://'
