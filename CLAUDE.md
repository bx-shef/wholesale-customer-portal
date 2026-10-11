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
pnpm b24:setup        # план настройки коробки по B24_WEBHOOK_URL; --apply — записать (docs/TEST_STAND.md)
make help             # цели сервера (docs/DEPLOY.md)
```

## Карта

| Где | Что |
|---|---|
| `app/` | страницы на Bitrix24 UI: `index` (каталог, пока пустой), `help` (справка из Nuxt Content) |
| `content/help/` | справка ЛК (коллекция `help`, `content.config.ts`) |
| `server/mcp/handlers/admin` | `/mcp/admin` — Bearer `MCP_ADMIN_TOKEN`, без токена закрыт для всех |
| `server/mcp/handlers/client` | `/mcp/client` — по сессии клиента; до этапа 2 закрыт для всех |
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
- **Данные клиента — только его компании**: фильтр по компании из сессии на сервере, всегда.
- **Секреты — только окружением** (`.env.example`); в лог не пишем.
- **Чистые функции отдельно** (`shared/`, `server/utils/`) с тестами; тест обязан краснеть при
  мутации (`AGENT_RULES.md` §5.2).
- **Язык** — `AGENT_RULES.md` §0: код по-английски; комментарии, документы, коммиты, PR — по-русски.
  Исключение — `scripts/**`: комментарии по-английски, как во флоте.
- **Штамп `> Last reviewed: YYYY-MM-DD`** под заголовком каждого `.md` (кроме шаблона PR и справки).
