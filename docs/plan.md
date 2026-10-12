# План работ

> Last reviewed: 2026-10-11

Около 6–7 недель на одного разработчика ЛК. Программист 1С работает параллельно по [onec-contract.md](onec-contract.md); стыковка — этап 6. Демо заказчику — после этапа 4, на моках.

Каждый пункт — отдельный PR (issue → ветка → PR → squash), процесс — по `docs/AGENT_RULES.md` из invoice-from-tasks.

## Этап 0. Подготовка — 2–3 дня

- [x] Каркас из bx-shef/skills-site: Nuxt 4 + Nuxt Content + `@bitrix24/b24ui-nuxt`, оболочка B24App, токены стилей; убрать контент сайта методологии и `sync-content`.
- [x] Процесс из invoice-from-tasks: `CLAUDE.md`, `docs/AGENT_RULES.md`, `docs/REPO_SETUP_CHECKLIST.md`, `docs/project-map.md`, `.claude/hooks/session-start.sh`, `.claude/skills/{b24-docs,review-panel,merge-pr}`, PR-шаблон из toolsai.
- [x] Инструменты: pnpm, eslint, vitest, `pnpm check`; `.github/workflows/ci.yml` (lint, typecheck, test, docker-build с дымовой проверкой контейнера; на `main` — образ в GHCR `latest` + `sha-…`), dependabot — по [DEPLOY.md](DEPLOY.md). Зелёный CI на GitHub — после открытия PR.
- [x] `@nuxtjs/mcp-toolkit` + zod, пустые `/mcp/client` и `/mcp/admin` с Bearer-проверкой.
- [x] Docker: `Dockerfile`, `docker-compose.yml` (127.0.0.1), `docker-compose.prod.yml` (метки Watchtower и `keepalive=disabled`), `Makefile` (doctor, health, prod-up, prod-redeploy, self-update); `compose-update` и `proxy-timeout` — когда появятся стрим ИИ-чата и правки compose (этап 5).
- [ ] Тестовая коробка Б24 на bitrix-tools/env-docker — порядок в `docs/TEST_STAND.md`, не поднята.
- [x] Скрипт настройки Б24 (идемпотентный, через вебхук): поле `UF_CRM_1C_GUID` у компании, смарт-процессы «Доступ в ЛК» и «Рейсы» с полями, воронка «Заявки ЛК». Placement `CRM_COMPANY_DETAIL_TAB` и `event.bind` вебхуком нельзя — нужен контекст приложения, перенесены в этап 2 (`docs/REST_METHODS.md`).
- [x] `.env.example`: `B24_WEBHOOK_URL`, `ONEC_URL`, `ONEC_TOKEN`, `ONEC_MOCK`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `SESSION_SECRET`, `MCP_ADMIN_TOKEN`.

Готово, когда: пустой ЛК на Bitrix24 UI открывается на тестовом сервере, CI зелёный, в Б24 созданы сущности.

## Этап 1. Контракт и мок 1С — 3–4 дня

- [x] `contracts/onec.openapi.yaml` по [onec-contract.md](onec-contract.md); zod-схемы `shared/onec/` — источник, OpenAPI собирается из них (`pnpm onec:openapi`).
- [x] Генератор данных `server/mocks/onec/seed.ts` (фиксированный seed).
- [x] Мок-маршруты `server/routes/mock-1c/*`: 7 методов, пагинация, `changedSince`, Bearer, ошибки; `_admin/reset`, `_admin/client`, `_admin/mode`, `_admin/cancel`; режимы задержки и 5xx.
- [x] HTTP-клиент `server/services/onec.ts` (таймауты, повторы, проверка ответа схемой, лог без секретов — паттерн `AConnector`).
- [x] Инструменты `onec_*` в `/mcp/admin`; синхронизация по курсору `changedSince` с журналом запусков (`server/utils/onecSync.ts`, паттерн insync). Хранилище курсоров и расписание — вместе с первым потребителем (этап 2).
- [x] Контрактные тесты `tests/contract/onec.spec.ts` (URL базы — из env, `pnpm test:contract`).
- [ ] Передать программисту 1С: контракт, адрес мока, команду тестов — всё в `docs/onec-contract.md`; адрес заработает после выката стенда `wsp.algena.by` с `ONEC_TOKEN`.

## Этап 2. Битрикс24 и доступ — 1 неделя

- [x] **Сначала — постоянное хранилище**: SQLite из Node (`node:sqlite`, без зависимостей) на томе `/data` — `server/db/sqlite.ts`, миграции по `user_version`; курсоры и журнал синхронизации (`sqliteSyncStore`), журнал входов. Б24 отвергнут: частая запись по REST коробки и зависимость от её доступности.
- [ ] Регистрация локального приложения на коробке: права, scope, обработчик установки.

- [x] Б24 на `B24Hook` (`server/utils/b24.ts`, `server/services/b24Access.ts`, `b24Companies.ts`); инструменты — `issue_access_key`, `revoke_access_key`, `sync_companies`. Прочие `b24_*` — вместе с потребителями (этапы 3–4).
- [x] Синхронизация компаний: клиенты 1С → компании Б24 по `UF_CRM_1C_GUID`, ответственный — по email менеджера из 1С; задача Nitro раз в 10 минут + `sync_companies`; курсор в SQLite.
- [ ] Установка приложения: `placement.bind` `CRM_COMPANY_DETAIL_TAB`, `event.bind`.
- [ ] Вкладка `/b24/company-tab` (`B24Frame`, фрейм-авторизация по образцу `frameAuth.ts`): контакты, статусы, выдать/отозвать/перевыпустить ключ.
- [x] Хэширование ключей (scrypt из node:crypto), запись в «Доступ в ЛК»; выдача и отзыв — `issue_access_key`, `revoke_access_key` в `/mcp/admin` (вкладка компании будет звать ту же логику).
- [x] Вход `/login`, JWT-сессия (HS256, httpOnly cookie 30 дней), проверка ключа в CRM не реже раза в 2 мин, лимит попыток (5 на логин, 30 на IP за 15 мин), журнал входов в SQLite.
- [x] Профиль: компания, договор (`onec_contract`), менеджер с «Позвонить».

Готово, когда: менеджер выдаёт ключ, сотрудник клиента входит и видит свою компанию.

## Этап 3. Каталог — 1 неделя

- [x] Индекс каталога и остатков в SQLite (`server/utils/catalog.ts`): каталог раз в час, остатки раз в 5 минут, первый прогон при старте; удалённое в 1С уходит из витрины.
- [x] Список с подгрузкой при прокрутке (и кнопкой «Показать ещё»), поиск по словам в названии и артикуле.
- [x] Фильтры в шторке (раздел с подразделами, бренд, «в наличии»), чипы, сортировка, состояние в адресе.
- [x] Цены договора пачкой для видимых товаров, кэш 15 минут по клиенту; 1С недоступна — каталог без цен с предупреждением.
- [x] Карточка товара: цена с НДС, кратность и минимум, остатки по складам, свойства, до 12 аналогов.
- [x] Нижняя навигация на телефоне.
- [ ] PWA и офлайн-кэш каталога — после этапа 4, когда появится корзина (кэшировать без неё нечего).

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
