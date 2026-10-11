# wholesale-customer-portal

ЛК для опта: B2B-кабинет клиентов поставщика с Битрикс24 (коробка) и 1С. Каталог с ценой клиента и остатками, заявки, дата приезда машины, ИИ-помощник на DeepSeek. Nuxt 4 + Bitrix24 UI + `@bitrix24/b24jssdk`, MCP на `@nuxtjs/mcp-toolkit`.

## Документация

- [docs/project.md](docs/project.md) — описание проекта коротко.
- [docs/spec.md](docs/spec.md) — полное техническое описание: экраны, доступ, обмены, MCP, моки, ИИ, доставка, UX, риски.
- [docs/plan.md](docs/plan.md) — план работ по этапам с задачами.
- [docs/START-PROMPT.md](docs/START-PROMPT.md) — стартовый промпт для новой сессии разработки.
- [docs/onec-contract.md](docs/onec-contract.md) — задание программисту 1С (HTTP-контракт; в прототипе — мок).
- [docs/related-repos.md](docs/related-repos.md) — связанные репозитории: что берём, зачем, как использовать, как следить за изменениями.
- [docs/upstream.lock.json](docs/upstream.lock.json) — разобранные версии связанных репозиториев; проверка — `.github/workflows/upstream-watch.yml`.

## Связанные репозитории

| Репозиторий | Зачем |
| --- | --- |
| [bx-shef/invoice-from-tasks](https://github.com/bx-shef/invoice-from-tasks) | Главный донор: тот же стек, процесс, серверные утилиты Б24, справка с ИИ |
| [bx-shef/skills-site](https://github.com/bx-shef/skills-site) | Каркас UI на Bitrix24 UI |
| [bx-shef/toolsai](https://github.com/bx-shef/toolsai) | Ведение проекта, права, релизы |
| [bx-shef/toolsai-mp3-txt](https://github.com/bx-shef/toolsai-mp3-txt) | Выкат Docker на BitrixVM |
| [adminsite-standartnoby/base](https://github.com/adminsite-standartnoby/base) | Деплой и обновление коробки Б24 |
| [bx-shef/haschangefiles](https://github.com/bx-shef/haschangefiles) | Учёт правок ядра |
| [bx-shef/insync](https://github.com/bx-shef/insync) | Паттерны синхронизаций |
| [bx-shef/currency](https://github.com/bx-shef/currency) | Курсы НБРБ; основа для НБКР |
| [bx-shef/ai-price-import](https://github.com/bx-shef/ai-price-import) | Разбор файлов ИИ, обратная связь |
| [bx-shef/skills-standard](https://github.com/bx-shef/skills-standard) | Навыки и приёмник отзывов |
| [bitrix-tools/env-docker](https://github.com/bitrix-tools/env-docker) | Официальное Docker-окружение Битрикс для тестовой коробки |
