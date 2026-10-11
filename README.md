# wholesale-customer-portal

> Last reviewed: 2026-10-11

ЛК для опта: B2B-кабинет клиентов поставщика с Битрикс24 (коробка) и 1С. Каталог с ценой клиента и остатками, заявки, дата приезда машины, ИИ-помощник на DeepSeek. Nuxt 4 + Bitrix24 UI + `@bitrix24/b24jssdk`, MCP на `@nuxtjs/mcp-toolkit`.

## Быстрый старт

```bash
pnpm install
cp .env.example .env
pnpm dev            # http://localhost:3000
pnpm check          # lint + typecheck + test
```

Правила работы — [CLAUDE.md](CLAUDE.md) и [docs/AGENT_RULES.md](docs/AGENT_RULES.md).

## Документация

- [docs/project.md](docs/project.md) — описание проекта коротко.
- [docs/spec.md](docs/spec.md) — полное техническое описание: экраны, доступ, обмены, MCP, моки, ИИ, доставка, UX, риски.
- [docs/plan.md](docs/plan.md) — план работ по этапам с задачами.
- [docs/START-PROMPT.md](docs/START-PROMPT.md) — стартовый промпт для новой сессии разработки.
- [docs/onec-contract.md](docs/onec-contract.md) — задание программисту 1С (HTTP-контракт; в прототипе — мок).
- [docs/project-map.md](docs/project-map.md) — где мы сейчас.
- [docs/TEST_STAND.md](docs/TEST_STAND.md) — тестовая коробка и настройка Б24 скриптом.
- [docs/REST_METHODS.md](docs/REST_METHODS.md) — какие методы Б24 зовём.
- [docs/DEPLOY.md](docs/DEPLOY.md) — выкат: стенд (GHCR + Watchtower) и ВМ Битрикс24 клиента.
- [docs/related-repos.md](docs/related-repos.md) — связанные репозитории: что берём, зачем, как использовать, как следить за изменениями.
- [docs/upstream.lock.json](docs/upstream.lock.json) — разобранные версии связанных репозиториев; проверка — `.github/workflows/upstream-watch.yml`.

## Связанные репозитории

| Репозиторий | Зачем |
| --- | --- |
| [bx-shef/invoice-from-tasks](https://github.com/bx-shef/invoice-from-tasks) | Главный донор: тот же стек, процесс, серверные утилиты Б24, справка с ИИ |
| [bx-shef/skills-site](https://github.com/bx-shef/skills-site) | Каркас UI на Bitrix24 UI |
| [bx-shef/toolsai](https://github.com/bx-shef/toolsai) | Ведение проекта, права, релизы |
| [bx-shef/client-bank-alfa-by](https://github.com/bx-shef/client-bank-alfa-by) | Эталон выката: GHCR + Watchtower, ВМ Битрикс24 |
| [bx-shef/import-client-bank](https://github.com/bx-shef/import-client-bank) | Приёмы workflow выката |
| [bx-shef/toolsai-mp3-txt](https://github.com/bx-shef/toolsai-mp3-txt) | Усиленный compose для BitrixVM |
| [adminsite-standartnoby/base](https://github.com/adminsite-standartnoby/base) | Деплой и обновление коробки Б24 |
| [bx-shef/haschangefiles](https://github.com/bx-shef/haschangefiles) | Учёт правок ядра |
| [bx-shef/insync](https://github.com/bx-shef/insync) | Паттерны синхронизаций |
| [bx-shef/currency](https://github.com/bx-shef/currency) | Курсы НБРБ; основа для НБКР |
| [bx-shef/ai-price-import](https://github.com/bx-shef/ai-price-import) | Разбор файлов ИИ, обратная связь |
| [bx-shef/skills-standard](https://github.com/bx-shef/skills-standard) | Навыки и приёмник отзывов |
| [bitrix-tools/env-docker](https://github.com/bitrix-tools/env-docker) | Официальное Docker-окружение Битрикс для тестовой коробки |
