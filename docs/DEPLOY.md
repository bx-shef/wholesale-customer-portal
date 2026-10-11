# Выкат ЛК

> Last reviewed: 2026-10-11

Схема выката собрана из трёх рабочих примеров флота. Код выката пишем на этапе 0 (CI, образ, compose, `Makefile`) и этапе 7 (ВМ клиента); здесь — что берём и почему.

| Пример | Как выкатывается | Что берём |
| --- | --- | --- |
| [bx-shef/invoice-from-tasks](https://github.com/bx-shef/invoice-from-tasks) — `docs/DEPLOY.md` | Образ в GHCR (`latest` + `sha-<коммит>`) → Watchtower → общий nginx-proxy + acme-companion | CI-конвейер, `docker-compose.prod.yml`, `Makefile` (`doctor`, `health`, `self-update`, `compose-update`, `proxy-timeout`, `backup`), `/api/health` с коммитом |
| [bx-shef/skills-site](https://github.com/bx-shef/skills-site) — `README.md` «Сервер», `.github/workflows/site-image.yml` | То же; дымовая проверка контейнера в CI до публикации | Дымовые проверки в CI (страницы, `503` чата без ключа, ширина 360 px), `proxy_buffering off` для стрима ИИ-чата, `deploy/proxy.compose.yml` |
| [bx-shef/client-bank-alfa-by](https://github.com/bx-shef/client-bank-alfa-by) — `docs/DEPLOY.md`, `docs/DEPLOY_BITRIXVM.md`, `deploy/bitrixvm/*` | Эталон для двух других. Основной таргет — GHCR + Watchtower; третий — **ВМ Битрикс24 клиента**: nginx bitrix-env → `127.0.0.1`, cron под `bitrix` опрашивает git, тянет образ по `sha-…`, проверяет health, откатывается | Весь таргет ВМ: `00-app-proxy.conf`, заглушка docroot, `git-poll-deploy.sh`, `server-files.txt`, `deploy.env.*.example`, оверлей `docker-compose.bitrixvm.yml` |
| [bx-shef/import-client-bank](https://github.com/bx-shef/import-client-bank) — `.github/workflows/deploy.yml` | Статика `nuxt generate` → rsync по SSH, бэкап прежней версии, смоук `curl` | Только приёмы workflow: секреты через `env:` шага (не `${{ secrets.* }}` в shell), `concurrency: deploy` без отмены, удаление ключа в `if: always()`. Сам способ не подходит — у ЛК есть сервер Nitro |

## Наша схема

ЛК — один node-контейнер (`nuxt build`, Nitro): страницы, `/api`, `/mcp/*`, мок 1С. Базы данных нет — доступ и рейсы в смарт-процессах Б24. Если появится кэш каталога в Redis — второй сервис в изолированной сети без портов наружу (как `redis` в client-bank-alfa-by).

### Конвейер (`.github/workflows/ci.yml`)

| Триггер | Что бежит |
| --- | --- |
| PR → `main` | `ci` (lint, typecheck, test, build) + `docker-build`: образ собирается, дымовая проверка контейнера (`/api/health`, `/login` 200, `/mcp/admin` без токена 401, чат без ключа 503, мок 1С отвечает), в реестр не идёт |
| push в `main` | `ci` → `deploy`: `ghcr.io/bx-shef/wholesale-customer-portal` с тегами `latest` и `sha-<коммит>` |
| `workflow_dispatch` | Повторный выкат без коммита |

- `deploy` ждёт зелёный `ci` (`needs: ci`); в GHCR пушит `GITHUB_TOKEN` с `packages: write`.
- Мерж только документации, тестов, `Makefile`, compose — образ не собирает (`paths-ignore`).
- Actions закреплены по SHA, обновляет Dependabot.
- Образ один на все серверы: адреса и секреты — из окружения при запуске. Единственный build-arg — коммит для `/api/health`.

### Таргет 1. Стенд — GHCR + Watchtower за nginx-proxy

Для демо на моках (после этапа 4) и тестов с программистом 1С. Как в invoice-from-tasks:

```bash
mkdir -p ~/wholesale-portal && cd ~/wholesale-portal
curl -fsSL -O https://raw.githubusercontent.com/bx-shef/wholesale-customer-portal/main/docker-compose.prod.yml
curl -fsSL -O https://raw.githubusercontent.com/bx-shef/wholesale-customer-portal/main/Makefile
umask 077 && $EDITOR .env      # DOMAIN, LETSENCRYPT_EMAIL, переменные ниже
make prod-up && make doctor
```

Метки контейнера в `docker-compose.prod.yml`:
- `com.centurylinklabs.watchtower.enable=true` — Watchtower один на хост, второй не поднимать;
- `com.github.nginx-proxy.nginx-proxy.keepalive=disabled` — иначе `502` на POST из портала (Node закрывает простаивающие соединения через 5 с, прокси держит 60 с; замер invoice-from-tasks 2026-09-25).

Для прокси: `vhost.d/<домен>_location` с `proxy_buffering off;` (стрим ИИ-чата, skills-site) и `proxy_read_timeout` для долгих ответов DeepSeek с tool calling (`make proxy-timeout`, invoice-from-tasks).

Откат и пауза автообновлений — `:latest` → `:sha-<7 знаков>` в compose на сервере, `make prod-up`.

### Таргет 2. Бой — ВМ Битрикс24 клиента

ЛК живёт рядом с коробкой поставщика. Берём `deploy/bitrixvm/` из client-bank-alfa-by (более зрелый, чем в toolsai-mp3-txt: учтены операции меню bitrix-env, статика, docroot). Главное:

1. **Домен и сертификат — только через меню bitrix-env.** Сгенерированные конфиги не трогаем.
2. **Проксирование** — один файл `/etc/nginx/bx/site_settings/<домен>/00-app-proxy.conf`: переопределяем `$proxyserver` на `http://127.0.0.1:<порт>` и перехватываем `location ^~ /_nuxt/` (иначе статику отдаст заглушка docroot). Свой `server` и `location /` не заводим. Применять только `nginx -t && systemctl reload nginx` — битый конфиг уронит и портал.
3. **Docroot** — заглушка `index.php` с `503`, `.htaccess` без чужих редиректов; `.htsecure` — только после выпуска сертификата.
4. **Стек не в docroot.** Три каталога: docroot сайта, стек (`compose`, `.env`, `Makefile`, `src/` — выборочная копия репозитория по `server-files.txt`), каталог выката (deploy key, токен реестра, `deploy.env`, состояние).
5. **Порт только `127.0.0.1`** — Docker обходит firewalld.
6. **Автообновление** — cron `bitrix` раз в 5 минут: `git ls-remote` → образ `sha-<коммит>` → `compose up` → `/api/health` → откат на прежний образ. Пауза — файл `state/paused`. Ротация лога — второй строкой crontab.
7. **Клиентский репозиторий.** Сервер клиента ходит только в свой репозиторий (deploy key только на чтение) и свой GHCR; наши обновления попадают туда merge'ем человека. Для одного поставщика допустим и вариант «сервер следит за нашим репозиторием» — решаем до пилота (открытый вопрос ниже).
8. `bitrix` в группе `docker` ≈ root на машине — осознанный размен, фиксируем у клиента.

Что не прогонялось: таргет ВМ у client-bank-alfa-by проверен на боевой ВМ частично (`make` не установлен — `yum install -y make`); у нас — сначала стенд на bitrix-tools/env-docker.

### Что нужно на стороне коробки

Не вливаем Nuxt в репозиторий коробки. Скрипт настройки Б24 (этап 0) идёт через вебхук; если поставщик ведёт коробку в git — его скрипты версионируем по схеме adminsite-standartnoby/base (`www/local/`, деплой PR → `main`).

ЛК обращается к порталу по `B24_WEBHOOK_URL`; на ВМ — внутренним адресом, без выхода в интернет. Placement `CRM_COMPANY_DETAIL_TAB` и `event.bind` указывают на внешний домен ЛК; смена домена — перерегистрация (как «Смена адреса сервера» в invoice-from-tasks).

## Переменные окружения

| Переменная | Зачем |
| --- | --- |
| `DOMAIN`, `LETSENCRYPT_EMAIL` | Стенд: домен для nginx-proxy и сертификата; из `DOMAIN` compose собирает `NUXT_PUBLIC_SITE_URL` |
| `APP_BIND_PORT` | ВМ: порт на `127.0.0.1`, по нему же проверка здоровья |
| `TRUST_PROXY=1` | За прокси: лимит попыток входа по IP клиента |
| `B24_WEBHOOK_URL` | Вебхук коробки |
| `ONEC_URL`, `ONEC_TOKEN`, `ONEC_MOCK` | 1С или мок |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | ИИ-помощник; без ключа чат отвечает `503`, ЛК работает |
| `SESSION_SECRET` | Подпись сессий клиентов (`openssl rand -hex 32`) |
| `MCP_ADMIN_TOKEN` | Bearer для `/mcp/admin` |
| `FEEDBACK_URL`, `FEEDBACK_TOKEN` | Приёмник оценок ИИ (skills-standard); пусто — канал выключен |

`make` запускает compose только с `.env` (без переменных оболочки) — приём invoice-from-tasks против соседних проектов на общем хосте. Копии `SESSION_SECRET` и `MCP_ADMIN_TOKEN` — вне сервера.

## Открытые вопросы

- [ ] Пилот на ВМ: клиентский репозиторий или прямое слежение за нашим?
- [ ] GHCR-пакет публичный или приватный (тогда `docker login` под `bitrix` с `read:packages`)?
- [ ] Домен ЛК: третий уровень у домена поставщика?
