# Выкат на виртуальную машину Битрикс24

> Last reviewed: 2026-10-13

ЛК живёт рядом с коробкой поставщика на её ВМ (bitrix-env). Схема — из bx-shef/client-bank-alfa-by
(`docs/DEPLOY_BITRIXVM.md`), там она прожита на боевой ВМ. Здесь — первый запуск вручную;
автообновление по опросу git (cron под `bitrix`) — следующим шагом, когда стенд заработает.

Как это устроено: nginx ВМ держит домен и сертификат и проксирует его в docker-контейнер ЛК на
`127.0.0.1:3000`. Наружу контейнер не смотрит. Образ — публичный `ghcr.io/bx-shef/wholesale-customer-portal`.

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
dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
docker network create proxy-net        # пустая: так требует базовый compose, наружу не ведёт
usermod -aG docker bitrix              # ⚠ группа docker ≈ root на машине — осознанный размен
```

## 3. Проксирование (root)

```bash
DOMAIN=wsp.algena.by                   # ←
curl -fsSL https://raw.githubusercontent.com/bx-shef/wholesale-customer-portal/main/deploy/bitrixvm/00-app-proxy.conf \
  -o "/etc/nginx/bx/site_settings/$DOMAIN/00-app-proxy.conf" \
  && nginx -t && systemctl reload nginx
```

⚠ `nginx -t` — до перезапуска и в одной цепочке: битый конфиг уронит nginx вместе с порталом.
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

Когда сертификат работает — HTTP→HTTPS штатным способом bitrix-env (root):
`touch /home/bitrix/ext_www/wsp.algena.by/.htsecure && chown bitrix:bitrix …/.htsecure`.
⚠ Не раньше: иначе редирект на несуществующий https отрежет и проверку Let's Encrypt.

## Обновление

Пока вручную: `make self-update && make prod-redeploy` под `bitrix`. Откат — в `.env` или в
compose `:latest` → `:sha-<7 знаков>` и `make prod-up`. Автообновление с проверкой здоровья и
откатом (cron + `git-poll-deploy.sh` из client-bank-alfa-by) — следующим PR.

## После каждой операции в меню bitrix-env

Проверить, что `00-app-proxy.conf` на месте и `nginx -t` проходит: меню не трогает `site_settings`,
но перевыпуск сертификата перегенерирует сайтовые конфиги.

## Что не проверено

На нашей ВМ ещё не прогонялось. Команды установки Docker — для AlmaLinux/CentOS 9, на которой
живёт bitrix-env 9; на другой ОС — по документации Docker.
