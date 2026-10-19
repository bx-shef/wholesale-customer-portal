# CLAUDE.md

> Last reviewed: 2026-10-19

ЛК для опта: B2B-кабинет клиентов поставщика с Битрикс24 (коробка) и 1С. Описание —
`docs/project.md`, ТЗ — `docs/spec.md`, план — `docs/plan.md`.

**Правила процесса — [`docs/AGENT_RULES.md`](docs/AGENT_RULES.md): они главнее этого файла.**
Коротко: в `main` только через PR; собрал или доработал PR — `/code-review` и панель из пяти
(навык `review-panel`); мерж — по навыку `merge-pr`. Этот файл — карта и конвенции, держим коротким.

## Команды

```bash
pnpm install          # + nuxt prepare (postinstall)
pnpm dev              # разработка
pnpm check            # lint + typecheck + test — перед каждым PR
pnpm build            # сборка .output/server/index.mjs
pnpm test:contract    # контрактные тесты 1С: мок; ONEC_CONTRACT_URL=… — тестовая база
pnpm onec:openapi     # пересобрать contracts/onec.openapi.yaml из shared/onec/schemas.ts
pnpm b24:setup        # план настройки коробки по B24_WEBHOOK_URL; --apply — записать (docs/TEST_STAND.md); на сервере — make b24-setup
make help             # цели сервера (docs/DEPLOY.md); журнал ИИ — make ai-dialogs
```

## Карта

| Где | Что |
|---|---|
| `app/` | страницы на Bitrix24 UI: `login`, `index` (каталог), `product/[guid]`, `cart`, `orders`, `profile`, `help` (справка из Nuxt Content); `AppHeader` (разделы; на телефоне — в меню-бургере), `useCart` (корзина в localStorage по компании) |
| `content/help/` | справка ЛК (коллекция `help`, `content.config.ts`) |
| `server/mcp/handlers/admin` | `/mcp/admin` — Bearer `MCP_ADMIN_TOKEN`, без токена закрыт для всех |
| `server/mcp/handlers/client` | `/mcp/client` — по сессии клиента (cookie или тот же токен Bearer) |
| `server/services/b24Access.ts` | доступ в ЛК поверх CRM: контакт по телефону/email, «Доступ в ЛК», компания с GUID 1С |
| `server/utils/login.ts`, `session.ts`, `accessKeys.ts`, `clientSession.ts` | вход с лимитом и журналом, подписанная сессия, ключи (scrypt), перепроверка ключа в CRM |
| `server/api/auth/{login,logout,me}`, `server/api/profile.get.ts` | вход, выход, кто вошёл, профиль |
| `server/utils/clientIp.ts` | адрес клиента для лимита: правый в `X-Forwarded-For` |
| `server/tasks/maintenance/prune.ts` | очистка журналов старше 90 дней |
| `server/utils/b24.ts`, `b24AppAuth.ts` | Битрикс24 токеном локального приложения (вебхука нет): приём установки (проверка продлением токена), хранение в SQLite, продление |
| `server/services/b24Companies.ts`, `server/utils/companySync.ts`, `server/tasks/sync/companies.ts` | клиенты 1С → компании Б24, по расписанию и `sync_companies` |
| `server/utils/profile.ts`, `app/pages/profile.vue` | профиль: договор из 1С, менеджер |
| `server/mcp/handlers/admin/tools/{issue,revoke}_access_key.ts` | выдача и отзыв ключа |
| `app/pages/b24/{app,company-tab,install}.vue` (на `app` — вкладка «Ближайшие доставки»), `server/api/b24/company-tab.post.ts`, `server/utils/managerTab.ts` | страница приложения в коробке, установка и вкладка «Личный кабинет» в карточке компании: ответственный за компанию или админ выдаёт и отзывает ключи; права — ответом портала на токен фрейма |
| `shared/onec/schemas.ts` | контракт 1С (zod) — единственный источник; OpenAPI — `contracts/onec.openapi.yaml` |
| `server/mocks/onec/` | мок 1С: сид, чистый обработчик, `fetch` в процессе |
| `server/routes/mock-1c/` | мок по HTTP, только при `ONEC_MOCK=true`, Bearer `ONEC_TOKEN` |
| `server/services/onec.ts` | клиент 1С: таймаут, без повторов (повтор — следующий цикл расписания), проверка схемой |
| `server/utils/onec.ts` | `useOnec()` — мок или `ONEC_URL` по окружению |
| `server/utils/onecProbe.ts`, `server/api/onec-test.{get,post}.ts`, `onecTestAuth.ts`, `onecTestPage.ts` | стенд проверки сервиса 1С `/api/onec-test` (логин/пароль `ONEC_TEST_LOGIN`/`ONEC_TEST_PASSWORD`): прогон контракта против адреса 1С (Bearer или логин/пароль) или мока |
| `server/api/system/*`, `server/utils/{systemStatus,systemPage,syncHealth}.ts` | страница «Состояние системы» `/api/system` (пароль стенда): потоки обмена, база, ручной запуск, управление моком — `docs/MONITORING.md` |
| `server/utils/{telegramAlert,alertDelivery}.ts`, `server/tasks/monitor/alerts.ts` | оповещения в Telegram по эпизодам (порт из client-bank-alfa-by), раз в 5 минут |
| `server/utils/onecSync.ts` | синхронизация по курсору с журналом запусков |
| `server/mcp/handlers/admin/tools/onec_*` | инструменты обмена с 1С |
| `server/utils/imageStore.ts`, `server/routes/images/[name].get.ts` | картинки товаров: из 1С base64 (`GET /image/{id}`), на томе `/data/images`, раздача `/images/<id>.<hash>` |
| `server/utils/catalog.ts`, `catalogSync.ts`, `prices.ts`, `catalogView.ts`, `catalogApi.ts` | индекс каталога и остатков, синхронизация, прайс по видам цен в базе (цена клиента — по его договору), каталог глазами клиента, обвязка маршрутов |
| `server/tasks/sync/{catalog,stock,prices}.ts`, `server/plugins/catalogWarmup.ts` | каталог раз в час, остатки раз в 5 минут, прайс раз в 15 минут, первый прогон при старте; к 1С ходит только расписание |
| `server/utils/onecGuard.ts` | бережём 1С: один запрос за раз, пауза 10 минут после трёх сбоев подряд (`onec-contract.md` §1.8) |
| `shared/catalogView.ts` | формы ответов каталога для сервера и страниц |
| `shared/cart.ts`, `server/utils/orders.ts`, `orderApi.ts`, `clients.ts` | правила корзины, расчёт и отправка заявки, клиенты 1С (договор, адреса) |
| `shared/delivery.ts` | ближайший рейс в бизнес-регион клиента и окно прибытия по Минску (§8 спецификации) |
| `server/utils/{delivery,deliverySync,deliveriesTab}.ts`, `server/tasks/sync/{schedule,trips}.ts`, `server/api/b24/deliveries.post.ts` | доставка ведётся только в 1С: график по регионам (раз в час) и задания на перевозку (раз в 10 минут) в базу ЛК; рейс заказа клиенту; вкладка «Ближайшие доставки» на странице приложения в коробке |
| `server/utils/aiChat.ts`, `server/api/ai/chat.post.ts`, `app/components/AiChatPanel.vue` | ИИ-помощник панелью справа (AI SDK + B24ChatMessages, стрим): DeepSeek + инструменты каталога с ценами договора; карточки — из выхода `show_products`, не из текста модели |
| `server/utils/aiJournal.ts`, `server/api/ai/rate.post.ts`, `server/mcp/handlers/admin/tools/ai_dialogs.ts` | журнал диалогов помощника и оценка 👍/👎; разбор — `make ai-dialogs` |
| `server/utils/rateLimit.ts` | лимит частоты на процесс (заявки, пересчёт корзины, звонок) |
| `server/services/b24Orders.ts` | сделка с товарами (идемпотентно по `ORIGIN_ID`), стадии воронки, комментарий в ленте, дело «перезвонить» |
| `server/utils/orderSync.ts`, `orderSyncRun.ts`, `server/tasks/sync/orders.ts` | раз в 2 минуты: досылка заявок без сделки, подтверждение менеджером → заказ 1С, статусы 1С → заявки и сделки; вручную — `sync_orders` |
| `server/api/{cart/quote,delivery,orders,callback}` | корзина, адреса и рейсы, заявки, звонок — только с сессией |
| `server/api/catalog/*` | список, фильтры, карточка — только с сессией, цены по компании сессии |
| `server/db/sqlite.ts`, `server/utils/db.ts` | база SQLite на томе `/data`: курсоры, журналы, каталог и остатки, клиенты 1С, заявки; миграции дописываются в конец |
| `server/utils/env.ts` | единственное чтение окружения (имена без `NUXT_`) |
| `server/utils/bearer.ts` | разбор и сверка Bearer за постоянное время |
| `server/api/health.get.ts` | живость, коммит сборки, что задано (без секретов) |
| `shared/b24Setup.ts` | что ЛК нужно в CRM и чего не хватает — чистый планировщик |
| `shared/b24SetupRun.ts` | прогон настройки CRM: при установке приложения, `b24_setup` в `/mcp/admin` (`make b24-setup`), `scripts/b24-setup.ts` — вебхуком на тестовом стенде |
| `tests/` | vitest; `repoGuards` — гарды репозитория (штампы, CI, выкат, реестр REST) |
| `Dockerfile`, `docker-compose*.yml`, `Makefile` | выкат — `docs/DEPLOY.md` |

## Конвенции

- **Весь UI — только Bitrix24 UI**, Nuxt UI не подключаем. Компоненты — по `llms.txt` b24ui.
- **По Битрикс24 не гадаем — читаем**: MCP `b24-dev-mcp`, навык `b24-docs`. Новый REST-метод —
  строка в `docs/REST_METHODS.md`, иначе краснеет `tests/repoGuards.test.ts`.
- **Обмены только приложение ↔ 1С и приложение ↔ Б24.** 1С в прототипе — мок по
  `docs/onec-contract.md`; браузер к Б24, 1С и DeepSeek напрямую не ходит.
- **Контракт 1С меняется только в `shared/onec/schemas.ts`**, затем `pnpm onec:openapi`; тест
  краснеет, если OpenAPI отстал.
- **Данные клиента — только его компании**: фильтр по компании из сессии на сервере, всегда.
- **Отказ входа — один текст на любую причину**; причина — только в журнале входов.
- **Секреты — только окружением** (`.env.example`); в лог не пишем.
- **Чистые функции отдельно** (`shared/`, `server/utils/`) с тестами; тест обязан краснеть при
  мутации (`AGENT_RULES.md` §5.2).
- **Язык** — `AGENT_RULES.md` §0: код по-английски; комментарии, документы, коммиты, PR — по-русски.
  Исключение — `scripts/**`: комментарии по-английски, как во флоте.
- **Штамп `> Last reviewed: YYYY-MM-DD`** под заголовком каждого `.md` (кроме шаблона PR и справки).
