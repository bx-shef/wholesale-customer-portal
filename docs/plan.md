# План работ

> Last reviewed: 2026-10-11

Около 6–7 недель на одного разработчика ЛК. Программист 1С работает параллельно по [onec-contract.md](onec-contract.md); стыковка — этап 6. Демо заказчику — после этапа 4, на моках.

Каждый пункт — отдельный PR (issue → ветка → PR → squash), процесс — по `docs/AGENT_RULES.md` из invoice-from-tasks.

## Этап 0. Подготовка — 2–3 дня

- [x] Каркас из bx-shef/skills-site: Nuxt 4 + Nuxt Content + `@bitrix24/b24ui-nuxt`, оболочка B24App, токены стилей; убрать контент сайта методологии и `sync-content`.
- [x] Процесс из invoice-from-tasks: `CLAUDE.md`, `docs/AGENT_RULES.md`, `docs/REPO_SETUP_CHECKLIST.md`, `docs/project-map.md`, `.claude/hooks/session-start.sh`, `.claude/skills/{b24-docs,review-panel,merge-pr}`, PR-шаблон из toolsai.
- [x] Инструменты: pnpm, eslint, vitest, `pnpm check`; `.github/workflows/ci.yml` (lint, typecheck, test, docker-build с дымовой проверкой контейнера; на `main` — образ в GHCR `latest` + `sha-…`), dependabot — по [DEPLOY.md](DEPLOY.md).
- [x] `@nuxtjs/mcp-toolkit` + zod, пустые `/mcp/client` и `/mcp/admin` с Bearer-проверкой.
- [x] Docker: `Dockerfile`, `docker-compose.yml` (127.0.0.1), `docker-compose.prod.yml` (метки Watchtower и `keepalive=disabled`), `Makefile` (doctor, health, prod-up, prod-redeploy, self-update); `compose-update` и `proxy-timeout` — когда появятся стрим ИИ-чата и правки compose (этап 5).
- [ ] Тестовая коробка Б24 на bitrix-tools/env-docker — порядок в `docs/TEST_STAND.md`, не поднята.
- [x] Скрипт настройки Б24 (идемпотентный, через вебхук): поле `UF_CRM_1C_GUID` у компании, смарт-процессы «Доступ в ЛК» и «Рейсы» с полями, воронка «Заявки ЛК». Placement `CRM_COMPANY_DETAIL_TAB` и `event.bind` вебхуком нельзя — нужен контекст приложения, перенесены в этап 2 (`docs/REST_METHODS.md`).
- [x] `.env.example`: `B24_WEBHOOK_URL`, `ONEC_URL`, `ONEC_TOKEN`, `ONEC_MOCK`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `SESSION_SECRET`, `MCP_ADMIN_TOKEN`.

Готово, когда: пустой ЛК на Bitrix24 UI открывается на тестовом сервере, CI зелёный, в Б24 созданы сущности.

## Этап 1. Контракт и мок 1С — 3–4 дня

- [ ] `contracts/onec.openapi.yaml` по [onec-contract.md](onec-contract.md); zod-схемы `shared/onec/`.
- [ ] Генератор данных `server/mocks/onec/seed.ts` (фиксированный seed).
- [ ] Мок-маршруты `server/routes/mock-1c/*`: 7 методов, пагинация, `changedSince`, Bearer, ошибки; `_admin/reset`, `_admin/client`; режимы задержки и 5xx.
- [ ] HTTP-клиент `server/services/onec.ts` (таймауты, повторы, лог без секретов — паттерн `AConnector`).
- [ ] Инструменты `onec_*`; курсоры `changedSince`; очередь со статусами (паттерн insync).
- [ ] Контрактные тесты `tests/contract/onec.spec.ts` (URL базы — из env).
- [ ] Передать программисту 1С: контракт, адрес мока, команду тестов.

## Этап 2. Битрикс24 и доступ — 1 неделя

- [ ] `server/services/b24.ts` на `B24Hook`; инструменты `b24_*`.
- [ ] Синхронизация компаний: `onec_companies` → `b24_upsert_company` по расписанию.
- [ ] Установка приложения: `placement.bind` `CRM_COMPANY_DETAIL_TAB`, `event.bind`.
- [ ] Вкладка `/b24/company-tab` (`B24Frame`, фрейм-авторизация по образцу `frameAuth.ts`): контакты, статусы, выдать/отозвать/перевыпустить ключ.
- [ ] Хэширование ключей, запись в «Доступ в ЛК».
- [ ] Вход `/login`, JWT-сессия, middleware, лимит попыток, журнал входов.
- [ ] Профиль: компания, договор (`onec_contract`), менеджер.

Готово, когда: менеджер выдаёт ключ, сотрудник клиента входит и видит свою компанию.

## Этап 3. Каталог — 1 неделя

- [ ] Индекс каталога из `onec_catalog` (кэш/хранилище сервера).
- [ ] Список с бесконечной прокруткой, поиск по названию и артикулу.
- [ ] Фильтры в шторке, чипы, сортировка, состояние в URL.
- [ ] Цены `onec_prices` пачкой для видимых товаров, остатки `onec_stock`; кэш.
- [ ] Карточка товара, остатки по складам, кратность, «Аналоги».
- [ ] Нижняя навигация, PWA.

## Этап 4. Заявки и доставка — 1 неделя

- [ ] Корзина (кратность, итог, комментарий, адрес).
- [ ] `b24_delivery` и расчёт ближайшего рейса с отсечкой.
- [ ] Отправка заявки → `b24_create_deal` + товары.
- [ ] Событие подтверждения → `onec_create_order` (идемпотентно по `externalId`).
- [ ] `onec_order_status` → `b24_update_deal`; экран «Мои заявки» с датой машины.
- [ ] «Позвонить» / «Заказать звонок» (`b24_callback`).

Готово, когда: сценарий «заявка → машина приедет» проходит целиком на моке. **Демо заказчику.**

## Этап 5. ИИ-помощник — 1 неделя

- [ ] `/api/ai/chat`: DeepSeek, tool calling через `/mcp/client`, стрим.
- [ ] Системный промпт с правилами; карточки товаров в ответе, «В корзину».
- [ ] `find_analogs`, `compare_products`.
- [ ] Лимит сообщений, журнал диалогов, оценка 👍/👎 (`RATING`).

## Этап 6. Подключение 1С — 2–3 дня

- [ ] Контрактные тесты на тестовой базе 1С, исправления у программиста 1С.
- [ ] `ONEC_MOCK=false`, сверка данных (компании, цены, остатки), первый реальный заказ.

## Этап 7. Пилот — 1–2 недели

- [ ] Выкат на ВМ клиента по схеме client-bank-alfa-by (`deploy/bitrixvm/*`): `00-app-proxy.conf` в `site_settings`, заглушка docroot, cron-опрос git с откатом — [DEPLOY.md](DEPLOY.md).
- [ ] 2–3 клиента, сбор замечаний, доработки, решение о запуске.

## Параллельно — программист 1С

| Когда | Что сдаёт |
| --- | --- |
| Этап 1 | Вопросы по контракту |
| Этап 2 | `GET /clients`, `GET /client/{guid}/contract` |
| Этап 3 | `GET /catalog`, `POST /prices`, `GET /stock` |
| Этап 4 | `POST /order`, `GET /orders/status` |
| Этап 5 | Сервис на тестовой базе, прогон контрактных тестов |
| Этап 6 | Исправления по тестам |
