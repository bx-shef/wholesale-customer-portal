# Исходящие вызовы REST Битрикс24

> Last reviewed: 2026-10-11

Реестр каждого метода, который зовёт ЛК. Добавили вызов в код — добавьте строку сюда:
`tests/repoGuards.test.ts` сверяет имена методов в `app/`, `server/`, `shared/`, `scripts/` с этим
файлом и краснеет на пропуске. Формат — из bx-shef/invoice-from-tasks.

Сигнатуры не дублируются: источник — MCP `b24-dev-mcp`. Здесь — кто зовёт, каким транспортом и
какие грабли уже известны.

**Транспорт.** «Вебхук» — `B24Hook` по `B24_WEBHOOK_URL` (сервер и скрипты). «Приложение» —
контекст установленного приложения (фрейм вкладки компании, события); появится на этапе 2.

**Статус.** 📄 — сверено с документацией MCP, на живом портале не проверялось; ✅ — проверено на
тестовой коробке.

| Метод | Кто зовёт | Транспорт | Статус | Заметки |
| --- | --- | --- | --- | --- |
| `crm.company.userfield.list` | `scripts/b24-setup.ts` | вебхук | 📄 | ищем `UF_CRM_1C_GUID` |
| `crm.company.userfield.add` | `shared/b24Setup.ts` | вебхук | 📄 | `FIELD_NAME` без префикса `UF_CRM_` — портал добавляет его сам |
| `crm.type.list` | `scripts/b24-setup.ts` | вебхук | 📄 | ответ `result.types[]`; `id` типа ≠ `entityTypeId` |
| `crm.type.add` | `shared/b24Setup.ts` | вебхук | 📄 | «Доступ в ЛК», «Рейсы» |
| `userfieldconfig.list` | `scripts/b24-setup.ts` | вебхук | 📄 | `entityId` смарт-процесса — `CRM_<id типа>` |
| `userfieldconfig.add` | `shared/b24Setup.ts` | вебхук | 📄 | код поля `UF_CRM_<id типа>_<POSTFIX>` |
| `crm.category.list` | `scripts/b24-setup.ts` | вебхук | 📄 | ответ `result.categories[]` |
| `crm.category.add` | `shared/b24Setup.ts` | вебхук | 📄 | воронка сделок «Заявки ЛК», `entityTypeId: 2` |
| `crm.item.fields` | `server/services/b24Access.ts` | вебхук | 📄 | ключи UF в `crm.item.*` — camelCase, правило не описано: ищем по исходному коду поля |
| `crm.duplicate.findbycomm` | `server/services/b24Access.ts` | вебхук | 📄 | контакт по телефону/email; до 20 значений; пустой ответ — массив, не объект |
| `crm.item.list` | `server/services/b24Access.ts` | вебхук | 📄 | «Доступ в ЛК» по одному `contactId`: оператор «в списке» не описан; результат перепроверяем |
| `crm.item.get` | `server/services/b24Access.ts` | вебхук | 📄 | запись доступа; компания (`entityTypeId: 4`) — название и `UF_CRM_1C_GUID` |
| `crm.item.add` | `server/services/b24Access.ts` | вебхук | 📄 | новая запись доступа с `contactId`, `companyId` |
| `crm.item.update` | `server/services/b24Access.ts` | вебхук | 📄 | перевыпуск, отзыв, последний вход |
| `crm.contact.company.items.get` | `server/services/b24Access.ts` | вебхук | 📄 | ключ выдаётся только контакту, привязанному к компании |

## Что вебхуком не делается

`placement.bind` (вкладка `CRM_COMPANY_DETAIL_TAB`) и `event.bind` требуют контекста приложения:
документация `placement.bind` прямо называет ошибку `WRONG_AUTH_TYPE … Application context
required`. Поэтому скрипт настройки их не регистрирует — это делает установка приложения на
этапе 2 (`docs/plan.md`).
