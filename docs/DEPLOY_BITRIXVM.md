# Выкат на виртуальную машину Битрикс24

> Last reviewed: 2026-10-13

ЛК живёт рядом с коробкой поставщика на её ВМ (bitrix-env). Схема — из bx-shef/client-bank-alfa-by
(`docs/DEPLOY_BITRIXVM.md`), там она прожита на боевой ВМ. Здесь — первый запуск вручную;
автообновление по опросу git (cron под `bitrix`) — следующим шагом, когда стенд заработает.

Как это устроено: nginx ВМ держит домен и сертификат и проксирует его в docker-контейнер ЛК на
`127.0.0.1:3000`. Наружу контейнер не смотрит. Образ — публичный `ghcr.io/bx-shef/wholesale-customer-portal`.

⚠ Команды скачивают файлы из `main` репозитория — шаги 3–6 выполнимы после того, как PR с ними влит.

Кто что делает: шаг 1 — владелец портала в меню bitrix-env, 2–4 — root, 5–6 — `bitrix`.
Строки с `←` замените своими значениями; переменные задавайте в каждом блоке заново — блоки
выполняются в разных сессиях.

## 1. Сайт и сертификат — только через меню bitrix-env

DNS: A-запись домена (`wsp.algena.by`) → IP ВМ. Затем в меню bitrix-env: создать сайт с этим
доменом (ext_www, без ядра), выпустить для него сертификат Let's Encrypt. Меню создаёт каталог
`/etc/nginx/bx/site_settings/<домен>/` и docroot `/home/bitrix/ext_www/<домен>`. Сгенерированные
меню конфиги не правим.

## 2. Docker и make (root, один раз)

```bash
dnf -y install dnf-plugins-core make
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin   # конфликт с podman/runc — добавить --allowerasing
systemctl enable --now docker
docker network create proxy-net        # пустая: так требует базовый compose, наружу не ведёт
usermod -aG docker bitrix              # ⚠ группа docker ≈ root на машине — осознанный размен
```

## 3. Проксирование (root)

```bash
DOMAIN=wsp.algena.by                   # ←
F=/etc/nginx/bx/site_settings/$DOMAIN/00-app-proxy.conf
curl -fsSL https://raw.githubusercontent.com/bx-shef/wholesale-customer-portal/main/deploy/bitrixvm/00-app-proxy.conf -o /tmp/00-app-proxy.conf \
  && install -m 644 -o root -g root /tmp/00-app-proxy.conf "$F" \
  && { nginx -t && systemctl reload nginx || { rm -f "$F"; echo "nginx -t не прошёл — файл убран, nginx не перезапускался"; }; }
```

⚠ `nginx -t` — до перезапуска, а при ошибке файл сразу убирается: оставленный битый конфиг уронит
nginx вместе с порталом при следующем перезапуске, в том числе из меню bitrix-env.
Почему не свой `server`-блок и почему статику перехватываем руками — в шапке самого файла.

## 4. Docroot — заглушка (root)

```bash
DOMAIN=wsp.algena.by                   # ←
D=/home/bitrix/ext_www/$DOMAIN
RAW=https://raw.githubusercontent.com/bx-shef/wholesale-customer-portal/main/deploy/bitrixvm/docroot
[ -f "$D/index.php" ] && cp -a "$D/index.php" "$D/index.php.orig-$(date +%F)"
curl -fsSL "$RAW/index.php" -o "$D/index.php" && curl -fsSL "$RAW/.htaccess" -o "$D/.htaccess"
chown bitrix:bitrix "$D/index.php" "$D/.htaccess" && chmod 644 "$D/index.php" "$D/.htaccess"
```

Заглушка отвечает 503: сюда запрос доходит, только если сломалось проксирование.

## 5. Стек (под `bitrix`, новый вход — чтобы применилась группа docker)

Стек — не в docroot: свой каталог в домашнем.

```bash
su - bitrix
mkdir -p ~/wholesale-portal && cd ~/wholesale-portal
RAW=https://raw.githubusercontent.com/bx-shef/wholesale-customer-portal/main
curl -fsSL -O $RAW/docker-compose.prod.yml
curl -fsSL -O $RAW/Makefile
curl -fsSL -O $RAW/deploy/bitrixvm/docker-compose.bitrixvm.yml
curl -fsSL -o .env $RAW/.env.example && chmod 600 .env
```

Заполнить `.env` (`nano .env`):

| Переменная | Значение |
| --- | --- |
| `DOMAIN` | `wsp.algena.by` (базовый compose требует; nginx-proxy на ВМ нет — инертно) |
| `ONEC_MOCK` | `true` — до подключения настоящей 1С |
| `ONEC_TOKEN` | `openssl rand -hex 16` — токен мока для программиста 1С |
| `SESSION_SECRET`, `MCP_ADMIN_TOKEN` | `openssl rand -hex 32` каждый; копии — вне сервера |
| `B24_WEBHOOK_URL` | входящий вебхук коробки, права `crm`, `user`; на ВМ можно внутренний https-адрес портала |
| `APP_BIND_PORT` | не задавать (3000); если занят — свой порт и тот же в `00-app-proxy.conf` |

## 6. Запуск и проверка (под `bitrix`)

```bash
cd ~/wholesale-portal
make prod-up
make health                                   # status: ok, коммит сборки
curl -s https://wsp.algena.by/api/health      # то же снаружи, через nginx ВМ
curl -sI https://wsp.algena.by/_nuxt/ | head -1   # не страница ошибки BitrixEnv
```

**Кто стоит перед ВМ** — от этого зависит лимит входа (шапка `00-app-proxy.conf`). С внешней
машины сделайте одну заведомо неверную попытку входа на `https://wsp.algena.by/login` и посмотрите,
какой адрес записан в журнал входов:

```bash
docker exec wholesale-customer-portal node -e "const d=new (require('node:sqlite').DatabaseSync)('/data/wholesale.sqlite');console.log(d.prepare('SELECT at, ip, reason FROM login_journal ORDER BY id DESC LIMIT 3').all())"
```

Должен быть внешний адрес вашей машины. Если там адрес балансировщика или NAT — перед ВМ прокси,
и в `00-app-proxy.conf` нужен `real_ip` (там же написано как).

Когда сертификат работает — HTTP→HTTPS штатным способом bitrix-env (root):

```bash
DOMAIN=wsp.algena.by                   # ←
touch "/home/bitrix/ext_www/$DOMAIN/.htsecure" && chown bitrix:bitrix "/home/bitrix/ext_www/$DOMAIN/.htsecure"
curl -sSI "http://$DOMAIN/" | head -3  # ожидаем 301 на https
```

⚠ Не раньше: иначе редирект на несуществующий https отрежет и проверку Let's Encrypt.

## Обновление

Пока вручную: `make self-update && make prod-redeploy` под `bitrix`. Откат и пауза — в `.env`:
`APP_IMAGE=ghcr.io/bx-shef/wholesale-customer-portal:sha-<7 знаков>` и `make prod-up`; вернуть
обновления — удалить строку. `self-update` обновляет compose, оверлей и `Makefile`; изменения
`00-app-proxy.conf` и docroot применяются вручную под root (шаги 3–4). Автообновление с проверкой здоровья и
откатом (cron + `git-poll-deploy.sh` из client-bank-alfa-by) — следующим PR.

## После каждой операции в меню bitrix-env

Проверить, что `00-app-proxy.conf` на месте и `nginx -t` проходит: меню не трогает `site_settings`,
но перевыпуск сертификата перегенерирует сайтовые конфиги.

## Что не проверено

На нашей ВМ ещё не прогонялось. Команды установки Docker — для AlmaLinux/CentOS 9, на которой
живёт bitrix-env 9; на другой ОС — по документации Docker.
