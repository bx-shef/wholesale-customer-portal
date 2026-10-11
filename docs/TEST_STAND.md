# Тестовая коробка Битрикс24

> Last reviewed: 2026-10-11

Стенд для разработки ЛК — официальное Docker-окружение Битрикс
[bitrix-tools/env-docker](https://github.com/bitrix-tools/env-docker) (поддерживает команда
1С-Битрикс; для боя «не рекомендуется, но не запрещено»). Боевая коробка поставщика остаётся на
BitrixVM (`docs/DEPLOY.md`, таргет 2).

⚠ **Стенд ещё не поднимался.** Порядок ниже собран по README env-docker (срез 2026-10-11), а не
по прогону. Поднимем — дополним замерами и поправим.

## Порядок

1. Docker и Compose на машине стенда; клон `bitrix-tools/env-docker`.
2. Пароли MySQL/PostgreSQL, Redis и секрет push-сервера — по разделам README env-docker
   («Пароли к базам данных», «Пароль для Redis», «Секретный ключ для Push-сервера»).
3. `docker compose up -d`, проверка `docker compose ps`. Сайт по умолчанию на портах
   **8588** (http) и **8589** (https).
4. Установка: раздел «BitrixSetup / Restore» — дистрибутив «Корпоративный портал» с пробным
   ключом либо восстановление копии портала поставщика. Нужна лицензия или пробный ключ.
5. В портале: «Разработчикам» → «Другое» → «Входящий вебхук», права `crm` (позже — `user_brief`,
   `placement` для установки приложения). Адрес — в `B24_WEBHOOK_URL`.
6. Настройка сущностей ЛК — идемпотентно, сначала посмотреть план:

   ```bash
   B24_WEBHOOK_URL=http://<стенд>:8588/rest/<id>/<код>/ pnpm b24:setup          # что будет создано
   B24_WEBHOOK_URL=… pnpm b24:setup --apply                                     # создать
   B24_WEBHOOK_URL=… pnpm b24:setup --apply                                     # второй прогон — поля смарт-процессов
   B24_WEBHOOK_URL=… pnpm b24:setup                                             # ждём «Portal is already set up»
   ```

   Создаётся: поле компании `UF_CRM_1C_GUID`, смарт-процессы «Доступ в ЛК» и «Рейсы» с полями,
   воронка сделок «Заявки ЛК» (`shared/b24Setup.ts`). Вкладка `CRM_COMPANY_DETAIL_TAB` и
   `event.bind` — не вебхуком: им нужен контекст приложения (`docs/REST_METHODS.md`), это этап 2.
7. ЛК рядом со стендом: `cp .env.example .env`, вписать `B24_WEBHOOK_URL`, `make build-local`,
   `curl -s 127.0.0.1:3000/api/health` — `config.b24Webhook: true`.

## Что не проверено

- Порядок на живом env-docker не прогонялся.
- `pnpm b24:setup` против настоящего портала не запускался: формы запросов сверены с документацией
  MCP, ответы — нет (`docs/REST_METHODS.md`, статус 📄).
