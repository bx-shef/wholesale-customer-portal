# CLAUDE.md

> Last reviewed: 2026-10-11

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
pnpm b24:setup        # план настройки коробки по B24_WEBHOOK_URL; --apply — записать (docs/TEST_STAND.md)
make help             # цели сервера (docs/DEPLOY.md)
```

## Карта

| Где | Что |
|---|---|
| `app/` | страницы на Bitrix24 UI: `login` (вход), `index` (каталог, пока пустой, за входом), `help` (справка из Nuxt Content) |
| `content/help/` | справка ЛК (коллекция `help`, `content.config.ts`) |
| `server/mcp/handlers/admin` | `/mcp/admin` — Bearer `MCP_ADMIN_TOKEN`, без токена закрыт для всех |
| `server/mcp/handlers/client` | `/mcp/client` — по сессии клиента (cookie или тот же токен Bearer) |
| `server/services/b24Access.ts` | доступ в ЛК поверх CRM: контакт по телефону/email, «Доступ в ЛК», компания с GUID 1С |
| `server/utils/login.ts`, `session.ts`, `accessKeys.ts`, `clientSession.ts` | вход с лимитом и журналом, подписанная сессия, ключи (scrypt), перепроверка ключа в CRM |
| `server/utils/b24.ts` | B24Hook по `B24_WEBHOOK_URL` (только https) |
| `server/services/b24Companies.ts`, `server/utils/companySync.ts`, `server/tasks/sync/companies.ts` | клиенты 1С → компании Б24, по расписанию и `sync_companies` |
| `server/utils/profile.ts`, `app/pages/profile.vue` | профиль: договор из 1С, менеджер |
| `server/mcp/handlers/admin/tools/{issue,revoke}_access_key.ts` | выдача и отзыв ключа |
| `shared/onec/schemas.ts` | контракт 1С (zod) — единственный источник; OpenAPI — `contracts/onec.openapi.yaml` |
| `server/mocks/onec/` | мок 1С: сид, чистый обработчик, `fetch` в процессе |
| `server/routes/mock-1c/` | мок по HTTP, только при `ONEC_MOCK=true`, Bearer `ONEC_TOKEN` |
| `server/services/onec.ts` | клиент 1С: таймаут, повторы, проверка схемой |
| `server/utils/onec.ts` | `useOnec()` — мок или `ONEC_URL` по окружению |
| `server/utils/onecSync.ts` | синхронизация по курсору с журналом запусков |
| `server/mcp/handlers/admin/tools/onec_*` | инструменты обмена с 1С |
| `server/db/sqlite.ts`, `server/utils/db.ts` | база SQLite на томе `/data`: курсоры, журнал синхронизации и входов; миграции дописываются в конец |
| `server/utils/env.ts` | единственное чтение окружения (имена без `NUXT_`) |
| `server/utils/bearer.ts` | разбор и сверка Bearer за постоянное время |
| `server/api/health.get.ts` | живость, коммит сборки, что задано (без секретов) |
| `shared/b24Setup.ts` | что ЛК нужно в CRM и чего не хватает — чистый планировщик |
| `scripts/b24-setup.ts` | запуск планировщика через `B24Hook` (вебхук) |
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
