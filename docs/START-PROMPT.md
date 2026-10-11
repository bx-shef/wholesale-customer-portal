# Стартовый промпт для новой сессии

> Last reviewed: 2026-10-11

Скопируйте в новую сессию, подключив репозиторий bx-shef/wholesale-customer-portal (и для чтения — bx-shef/skills-site, bx-shef/invoice-from-tasks).

---

Проект — bx-shef/wholesale-customer-portal: B2B-кабинет клиентов поставщика (Битрикс24 коробка + 1С), Nuxt 4 + Bitrix24 UI + @bitrix24/b24jssdk, MCP на @nuxtjs/mcp-toolkit, ИИ на DeepSeek.

Прочитай по порядку: `README.md`, `docs/project.md`, `docs/spec.md`, `docs/plan.md`, `docs/onec-contract.md`, `docs/related-repos.md`.

Правила:
- Весь UI — только компоненты Bitrix24 UI, Nuxt UI не подключаем.
- Обмены только приложение ↔ 1С и приложение ↔ Б24; 1С в прототипе — мок по контракту.
- REST Битрикс24 не по памяти — MCP `b24-dev-mcp`; b24jssdk и b24ui — их llms.txt.
- В `main` только через PR; язык документов, коммитов и PR — русский, код — английский.

Начни с этапа 0 из `docs/plan.md`: каркас из skills-site, процесс и CI из invoice-from-tasks (пути — в `docs/related-repos.md`), mcp-toolkit, Docker, скрипт настройки Б24. Каждый пункт — отдельный PR.
