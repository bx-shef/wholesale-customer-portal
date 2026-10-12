# Связанные репозитории: что берём и зачем

> Last reviewed: 2026-10-11

Срез на 2026-10-11. По каждому репозиторию: что это, зачем нам, что берём (с путями), как использовать, риски.
Как следить за изменениями — в конце документа и в [`upstream.lock.json`](upstream.lock.json).

Сводка:

| Репозиторий | Роль для нас | Что берём в первую очередь |
| --- | --- | --- |
| [bx-shef/invoice-from-tasks](https://github.com/bx-shef/invoice-from-tasks) | **Главный донор**: тот же стек (Nuxt 4 + Bitrix24 UI + b24jssdk) | Правила ведения проекта, CI, серверные утилиты Б24, UF-типы, справка с ИИ-чатом |
| [bx-shef/skills-site](https://github.com/bx-shef/skills-site) | Каркас UI на Bitrix24 UI вместо Docus | Оболочка B24App, токены стилей, поиск, чат-оверлей, Docker |
| [bx-shef/toolsai](https://github.com/bx-shef/toolsai) | Пример ведения проекта и модуля коробки | Процесс (agent-rules, PR-шаблон, CHANGELOG, релиз по тегу), модель прав «действия → роли → назначения», мок-провайдер |
| [bx-shef/client-bank-alfa-by](https://github.com/bx-shef/client-bank-alfa-by) | **Эталон выката**: GHCR + Watchtower и таргет «ВМ Битрикс24» | `docs/DEPLOY*.md`, `deploy/bitrixvm/*` (nginx `site_settings`, docroot, cron-опрос git, откат) |
| [bx-shef/import-client-bank](https://github.com/bx-shef/import-client-bank) | Выкат статики по SSH | Приёмы workflow `deploy.yml`: секреты через `env:`, `concurrency`, очистка ключа |
| [bx-shef/toolsai-mp3-txt](https://github.com/bx-shef/toolsai-mp3-txt) | Выкат Docker-сервиса на BitrixVM | Усиленный compose, тесты скрипта выката; сам выкат — по client-bank-alfa-by |
| [adminsite-standartnoby/base](https://github.com/adminsite-standartnoby/base) | Репозиторий коробки: деплой и обновление Б24 | Схема деплоя `www/local/`, стражи дерева, правило «ядро не правим» |
| [bx-shef/haschangefiles](https://github.com/bx-shef/haschangefiles) | Учёт правок ядра | Только соглашение и CLI-проверку — если всё же придётся править ядро |
| [bx-shef/insync](https://github.com/bx-shef/insync) | Заготовки синхронизаций (PHP) | Паттерны: очередь со статусами, стратегии ошибок, идемпотентность по внешнему ключу |
| [bx-shef/currency](https://github.com/bx-shef/currency) | Курсы НБРБ → модуль «Валюты» | Логика строгого разбора |
| [bx-shef/ai-price-import](https://github.com/bx-shef/ai-price-import) | Разбор файлов ИИ → CRM, контур обратной связи | Извлечение текста, LLM-шлюз с DeepSeek, `crmWrite`, виджет оценки |
| [bx-shef/skills-standard](https://github.com/bx-shef/skills-standard) | Стандарт навыков и приёмник отзывов | Формат обратной связи, `feedback/server.js`, навыки проекта + `bxshef lint/eval` |
| [bitrix-tools/env-docker](https://github.com/bitrix-tools/env-docker) | Официальное Docker-окружение Битрикс (команда 1С-Битрикс) | Локальный/тестовый стенд коробки Б24 для разработки и смоук-тестов |

---

## bx-shef/invoice-from-tasks — главный донор

**Что это.** REST-приложение Б24 «Счёт из задач»: Nuxt 4, `@bitrix24/b24ui-nuxt` 2.x, `@bitrix24/b24jssdk` 3.x, vitest, pnpm, Docker. Сделано под облако.

**Зачем нам.** Стек совпадает с нашим полностью, поэтому отсюда берём больше всего — и процесс, и код.

**Что берём.**
- Процесс: `docs/AGENT_RULES.md` (только PR, squash в Conventional Commits на русском, follow-up issue), `docs/REPO_SETUP_CHECKLIST.md` (ruleset `protect-main`, обязательные проверки `ci` и `docker-build`), `docs/project-map.md` (срез со статусами), шаблон `CLAUDE.md`, `.claude/hooks/session-start.sh`, `.claude/skills/{b24-docs,review-panel,merge-pr}`.
- CI и инструменты: `.github/workflows/ci.yml` (Actions закреплены по SHA), `.github/dependabot.yml`, `eslint.config.mjs`, `vitest*.config.ts`, `Dockerfile`, `Makefile`, `docker-compose.prod.yml`.
- Сервер: `server/utils/{frameAuth,tokenStore,secretCrypto,b24Host,b24Events,b24EventsHandler,rateLimit,requestLimits,verifyInstallMember}.ts`, `server/middleware/securityHeaders.ts` — для вкладки компании (B24Frame) и событий Б24.
- Клиент: `app/composables/{useB24,useApi}.ts`, `app/utils/frameToken.ts`, `app/pages/install.vue`.
- Свой UF-тип для карточки компании: `shared/domain/appFieldTypes.ts`, `app/pages/uf/access-code.vue` — прямой аналог поля «ключ доступа к ЛК».
- Справка с ИИ-чатом: `shared/domain/kb.ts` (BM25), `kbStream.ts`, `server/api/kb/*`, `app/components/help/*`; LLM-шлюз `server/utils/{llm,aiGateway}.ts` переводим на DeepSeek.
- Смоук на живом портале: `smoke/`, `docs/SMOKE.md`.

**Как использовать.** Копируем файлы в нашу структуру на этапе 0 (подготовка), адаптируем под коробку: OAuth-хост коробки, события на внутренний адрес, вебхук вместо токена установщика там, где это проще.

**Риски.** Облачная модель (OAuth-хост, публичный сервер) — на коробке сверить доступность в обе стороны. `app.option` ограничен по месту — ключи доступа храним в смарт-процессе «Доступ в ЛК», не в опциях. Автодеплой каждого коммита `main` без релизов для портала клиента — заменяем на релизы по тегу (см. toolsai).

## bx-shef/skills-site — каркас UI

**Что это.** Сайт методологии на Nuxt 4 + Nuxt Content + Bitrix24 UI (без Nuxt UI), чат через OpenAI-совместимого провайдера, Docker + nginx-proxy.

**Что берём.** `app/app.vue` (оболочка B24App), `app/assets/css/*` (порядок: tokens → layout → content → components), `app/components/Hd{Header,Search,ChatOverlay}.vue`, `server/api/assistant.post.ts` и `server/utils/chat-config.ts` (DeepSeek уже описан в `.env.example`), `Dockerfile`, `docker-compose.prod.yml`, `Makefile`, `deploy/proxy.compose.yml`; из `.github/workflows/site-image.yml` — дымовые проверки контейнера до публикации образа.

**Как использовать.** Раскладку helpdesk меняем на мобильный каталог; страницы каталога, корзины, заявок пишем на тех же компонентах Bitrix24 UI.

**Риски.** Сделан под документацию, а не под каталог; переиспользуем оболочку, а не страницы.

## bx-shef/toolsai — пример ведения проекта

**Что это.** PHP-модуль `shef.toolsai` для коробки: свой ИИ-движок для BitrixGPT, квоты, анализ сделок, права, база знаний на Nuxt + Bitrix24 UI (`site/` → `kb/`).

**Что берём.**
- Процесс: `docs/private/agent-rules.md` (только PR, `/code-review`, панель ревьюеров на рискованное), `.github/pull_request_template.md` («Что и зачем / Документация / Проверка / Что не проверено / Refs #»), `CHANGELOG.md` с секцией на версию, `.github/workflows/release.yml` (релиз по тегу `v*` со сверкой версии).
- Разделение документации: публичная `docs/guide/` (идёт в справку и ИИ-чат) и внутренняя `docs/private/`.
- Модель прав: `lib/access/actions.php` (словарь действий с зависимостями), `rolestore.php`, `rightspage.php` — образец для ролей поставщика (кто выдаёт ключи, кто видит заявки) и, позже, ролей внутри компании клиента.
- `docker/mock-openai/router.php` — идея мок-провайдера (у нас — мок 1С и DeepSeek).
- `tools/kb-build.sh` — сборка справки и RAG-чанков для чата.

**Риски.** Код PHP, к Nuxt напрямую не переносится; права там в таблицах модуля, у нас — в смарт-процессе через REST.

## bx-shef/client-bank-alfa-by — эталон выката

**Что это.** Приложение «Импорт из клиент-банка» (Альфа-Банк): Nuxt + backend Nitro + Postgres + Redis/BullMQ. На его `docs/DEPLOY.md` ссылаются invoice-from-tasks и skills-site.

**Что берём.** Подробно — [DEPLOY.md](DEPLOY.md).
- `docs/DEPLOY.md`: конвейер `ci` → `deploy` (matrix образов, `fail-fast: false`), GHCR + Watchtower, требования к `X-Forwarded-For`/`X-Forwarded-Proto` для лимита входа и `Secure`-cookie.
- `docs/DEPLOY_BITRIXVM.md` и `deploy/bitrixvm/`: `nginx/00-app-proxy.conf` (переопределение `$proxyserver`, перехват `/_nuxt/`), `docroot/` (заглушка 503), `git-poll-deploy.sh`, `server-files.txt` (выборочная копия репозитория на сервере), `deploy.env.{client,upstream}.example`, `docker-compose.bitrixvm.yml`.
- `docs/OPERATIONS.md` — образец runbook эксплуатации.

**Риски.** Стек тяжелее нашего (Postgres, Redis, два образа) — берём механизм, не сервисы. Схема «клиентский репозиторий» добавляет репозиторий на клиента.

## bx-shef/import-client-bank — выкат статики

**Что это.** Ранняя версия импорта выписок: `nuxt generate`, `deploy.yml` — rsync по SSH с бэкапом прежней версии и смоук `curl`.

**Что берём.** Только приёмы workflow: секреты в `env:` шага, `concurrency: { group: deploy, cancel-in-progress: false }`, удаление ключа в `if: always()`, проверка непустого `.output`. Способ выката не подходит — ЛК нужен сервер Nitro.

## bx-shef/toolsai-mp3-txt — Docker на BitrixVM

**Что это.** FastAPI-сервис распознавания речи, который ставится на ту же VM, что и портал; интересен не код, а механизм выката.

**Что берём.**
- `deploy/bitrixvm/asr-deploy.sh` — cron пользователя `bitrix` раз в 5 минут: `git fetch` → образ `ghcr.io/...:sha-<коммит>` → `compose up` → проверка `/health` → откат при сбое; состояние в `state/{deployed_sha,failed_sha,paused}`.
- `deploy/bitrixvm/Makefile` (`check`, `status`, `install`, `pause`/`resume`, `self-update`), `deploy.env.example`, `docs/DEPLOY_BITRIXVM.md`.
- Усиленный compose: `read_only`, `cap_drop: ALL`, `no-new-privileges`, лимиты, порт только `127.0.0.1` (Docker обходит firewalld).
- `tests/test_deploy_script.py`, `tests/test_makefile.py` — тесты скрипта выката на подменах; `docs/CONTRACT.md` — образец описания HTTP-контракта (для `contracts/onec.openapi.yaml`).

**Как использовать.** Усиленный compose и тесты скрипта выката. Сам выкат на ВМ берём у client-bank-alfa-by — там учтены nginx bitrix-env, статика и docroot ([DEPLOY.md](DEPLOY.md)).

**Риски.** ЛК открывают снаружи — нужен reverse proxy: location в nginx bitrix-env на `127.0.0.1:<порт>`. На живой BitrixVM схема ещё не прогонялась (сказано в самом документе). Пользователь `bitrix` в группе `docker` почти равен root.

## adminsite-standartnoby/base — репозиторий коробки

**Что это.** Git-репозиторий боевой коробки standartno.by: корень = `/home/bitrix`, ядро, `www/local/`, приложения; `.gitignore` по белому списку.

**Что берём.**
- Деплой: issue → PR → squash в `main` → `.github/workflows/deploy.yml` (SSH, `scripts/disk-space-guard.sh`, `scripts/clean-tree-guard.sh`, `git reset --hard origin/main`); секреты и `upload/` не в git.
- Обновление Битрикса: `docs/infra/bitrix-update.md` — страж блокирует деплой, пока обновление ядра не оформлено веткой и PR.
- Правило «ядро не правим, только `www/local/`»; иначе — `docs/infra/core-changes.md`.
- `scripts/check-no-secrets.sh`, `docs/infra/payment-chain.md` (работа через вебхук).

**Как использовать.** Всё, что нашему ЛК нужно на стороне коробки, — версионируем как код по этой схеме: скрипты создания смарт-процессов «Доступ в ЛК» и «Рейсы», поля `UF_CRM_1C_GUID`, воронки «Заявки ЛК», регистрация placement `CRM_COMPANY_DETAIL_TAB`, вебхук. Сам Nuxt-проект туда не вливаем.

**Риски.** 3,6 ГБ, привязан к одному порталу; процедура обновления «проходится впервые»; деплой из `main` без staging.

## bx-shef/haschangefiles — правки ядра

**Что это.** Модуль `shef.haschangefiles`: правка в ядре оборачивается маркерами `// change ////` … `// change stop ////`, рядом зеркало `has-change_<файл>`; отчёт `OK/DRIFT/NO-ORIGINAL` в админке и CLI `cli/check-core-changes.php --diff`.

**Зачем нам.** По архитектуре ЛК ядро не трогаем (REST, placement, вебхук, `local/`). Модуль нужен, только если у клиента уже есть правки ядра — тогда запускаем CLI-проверку после каждого обновления Б24.

**Риски.** Только UTF-8, нужен `shef.options`; зеркала обязательно закрыть в веб-сервере (`docs/webserver.md`).

## bx-shef/insync — заготовки синхронизаций

**Что это.** PHP-модуль `shef.insync`: абстракции агентов, промежуточная таблица импорта со статусами, импорт из CSV/XML, выборка CRM по `entityTypeId`, ORM-модели каталога/цен/остатков/складов, клиент внешнего API.

**Что берём (паттерны, переписываем на TS в `server/mcp/tools` и `server/tasks`).**
1. Очередь со статусами (`Sync\Model\SyncTable`, `ESTATUS`) и стратегии ошибок `simple / markfail / hidefail` — для потоков `onec_*`: принять → обработать → повтор.
2. Идемпотентность по внешнему ключу (`getByXmlId`) — GUID 1С у компании и `XML_ID` у товара.
3. Пакетная выборка CRM по `entityTypeId` (`Sync\Crm\ACrmProcess`) — для `crm.item.list` смарт-процессов.
4. Единый клиент внешнего API с логом (`Api\AConnector`) — для клиента 1С и DeepSeek.

**Риски.** PHP внутри коробки, зависимости `shef.options`, `shef.problems`. Перенос обмена на коробку противоречит нашей схеме «обмен только через приложение».

## bx-shef/currency → курсы НБРБ

**Что это.** Модуль `shef.currency`: агент раз в сутки берёт `https://services.nbrb.by/XmlExRates.aspx?ondate=…`, строго разбирает XML (сверка даты, отбраковка подозрительных строк), пишет курсы в штатный модуль «Валюты» (`\CCurrencyRates::Add/Update`). Базовая валюта — BYN.

**Решение владельца 2026-10-12:** клиент в Беларуси, валюта BYN, курсы — НБРБ. Ветка с НБКР (Бишкек) снята. Если 1С отдаёт цены в BYN, курсы ЛК не нужны вовсе; если часть цен в валюте — модуль ставится на коробку как есть, либо его строгий разбор переносится в Nitro-задачу ЛК.

## bx-shef/ai-price-import — разбор файлов и обратная связь

**Что это.** Облачное приложение Маркета: файл (накладная, счёт, прайс) → извлечение текста → LLM → JSON позиций → поиск в Б24 → `crm.item.add` + `crm.item.productrow.set`. Стек: Nuxt 4 + Nitro, BullMQ + Redis, Postgres, Bitrix24 UI.

**Что берём.**
- Заказ файлом в ЛК (клиент загружает свою заявку Excel/PDF): `server/utils/textExtract.ts`, `textSanitize.ts`, `server/agent/*` (`openaiChat`, `chatExtract`, `extractJson`, `retry`), `prompts/extract.ts`. В `server/agent/llmConfig.ts` DeepSeek уже есть (`LLM_PROVIDER=deepseek`).
- `server/utils/crmWrite.ts` — образец записи сделки с товарами из корзины.
- Обратная связь: `app/composables/useFeedback.ts`, `app/components/FeedbackWidget.vue` (👍/👎 + комментарий), `server/api/feedback.post.ts`, принцип fail-closed из `feedbackConfig.ts` (нет настроек — канал выключен, 503).

**Риски.** Мультитенантный OAuth избыточен для одного коробочного портала. Тяжёлые зависимости (Redis, Postgres, LibreOffice, OCR) — берём только когда понадобится заказ файлом. Отзывы уходят в GitHub Issues — для закрытого контура клиента не подходит, используем приёмник из skills-standard.

## bx-shef/skills-standard — навыки и обратная связь

**Что это.** Стандарт навыков ИИ-агентов (`STANDARD.md`, `METHOD.md`), CLI `bxshef` (lint, eval, feedback), GitHub Action, шаблон репозитория навыков, приёмник отзывов `feedback/server.js` (образ `ghcr.io/bx-shef/skills-standard-feedback`).

**Формат отзыва** (`POST /feedback`): `category` (`BUG | SUGGESTION | DOCS | CHAT | BOTS | OTHER | RATING`), `title` 3–200, `body` 10–20000, `context` (обязательно `skill`; `outcome` `done|partial|failed`, `helped[]`, `agent`, `version`; для `RATING` — `rating` ±1, модель, страница). Ответ `201` / `400 VALIDATION_ERROR` / `429`. Секреты вычищаются, необязательный Bearer `FEEDBACK_TOKEN`.

**Что берём.**
- Оценка ответов ИИ-чата ЛК: серверный роут шлёт `RATING` с `context: { skill: "wholesale-customer-portal", rating, model, page }`, текстовые — `CHAT / BUG / SUGGESTION`. Приёмник поднимаем рядом с ЛК (`docker-compose.prod.yml`) или используем общий.
- MCP-инструмент `send_feedback` с той же схемой — отзыв может отправить сам ИИ-агент (как в `template/skills/acme-feedback/SKILL.md`).
- Навыки проекта (`.claude/skills/*`) — по `STANDARD.md`, проверка `npx bxshef lint/eval` в CI.

**Риски.** Схема заточена под навыки (`context.skill` обязателен); персональные данные клиентов отправлять нельзя — отзывы B2B-клиента о заказах ведём в самом Б24 (дело/обращение), в приёмник — только обезличенные оценки ИИ.

## bitrix-tools/env-docker — Docker для Битрикс24

**Что это.** Официальное контейнерное окружение Битрикс, поддерживается командой 1С-Битрикс: nginx, PHP, MySQL/PostgreSQL, Redis, Memcache, push-сервер, Sphinx, cron для агентов, `bitrixsetup.php` / `restore.php`, SSL (самоподписанные и Let's Encrypt через lego). Предназначено для dev-сайта; для боя «не рекомендуется, но не запрещено».

**Как использовать.** Тестовая коробка Б24 для разработки ЛК: поднимаем, ставим дистрибутив корпоративного портала или восстанавливаем копию портала клиента, создаём смарт-процессы и вебхук скриптами из репозитория, гоняем смоук-тесты ЛК. На боевой VM клиента остаётся BitrixVM.

**Риски.** Нужна лицензия/пробный ключ для коробки; продакшен-эксплуатация требует отдельного усиления.

---

## Как следить за изменениями

1. **Файл-замок** [`docs/upstream.lock.json`](upstream.lock.json) — какие коммиты репозиториев мы разобрали (ветка, SHA, дата) и что из них берём.
2. **Автоматическая проверка** — `.github/workflows/upstream-watch.yml` раз в неделю (и вручную) сравнивает последний коммит ветки каждого репозитория с замком и открывает/обновляет issue «Изменения в связанных репозиториях» со списком коммитов и изменённых файлов, которые нас касаются. Для приватных репозиториев нужен секрет `UPSTREAM_TOKEN` (fine-grained PAT с правом чтения contents).
3. **Разбор изменений** — для каждого пункта issue: смотрим diff нужных путей (`watch` в замке), решаем «переносим / пропускаем», переносим отдельным PR со ссылкой на коммит-источник, затем обновляем SHA в замке тем же PR.
4. **Вручную на GitHub** — Watch → Custom → Releases для репозиториев с релизами (toolsai, currency, skills-standard), RSS `https://github.com/<owner>/<repo>/commits/main.atom` для остальных.
5. **CHANGELOG** — есть у toolsai, haschangefiles, insync, currency, skills-standard (`bxshef/CHANGELOG.md`); при обновлении замка читаем его в первую очередь.
