# Стартовый промпт для новой сессии

> Last reviewed: 2026-10-21

Скопируйте в новую сессию, подключив репозиторий bx-shef/wholesale-customer-portal (и для чтения — bx-shef/skills-site, bx-shef/invoice-from-tasks, bx-shef/client-bank-alfa-by).

---

Проект — bx-shef/wholesale-customer-portal: B2B-кабинет клиентов поставщика (Битрикс24 коробка + 1С), Nuxt 4 + Bitrix24 UI + @bitrix24/b24jssdk, MCP на @nuxtjs/mcp-toolkit, ИИ на DeepSeek.

Прочитай по порядку: `CLAUDE.md`, `docs/AGENT_RULES.md`, `docs/project-map.md` (где мы), `docs/plan.md`, `docs/onec-odata.md` (1С только по OData), `docs/spec.md`, `docs/DEPLOY.md`.

Правила:
- Весь UI — только компоненты Bitrix24 UI, Nuxt UI не подключаем.
- Обмены только приложение ↔ 1С и приложение ↔ Б24; 1С — по OData (`ONEC_MODE=odata`) или мок по `docs/onec-contract.md`.
- REST Битрикс24 не по памяти — MCP `b24-dev-mcp`; b24jssdk и b24ui — их llms.txt.
- В `main` только через PR; язык документов, коммитов и PR — русский, код — английский.

Продолжай с раздела «Дальше» в `docs/project-map.md`. Каждая задача — отдельный PR, панель из пяти (навык `review-panel`), мерж — навык `merge-pr`. Проверить кабинет в браузере — `docs/CHROME_CHECK_PROMPT.md`.
