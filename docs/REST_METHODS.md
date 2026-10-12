# Исходящие вызовы REST Битрикс24

> Last reviewed: 2026-10-12

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
| `crm.type.list` | `scripts/b24-setup.ts`, `server/services/b24Access.ts`, `b24Orders.ts` | вебхук | 📄 | ответ `result.types[]`; `id` типа ≠ `entityTypeId` |
| `crm.type.add` | `shared/b24Setup.ts` | вебхук | 📄 | «Доступ в ЛК», «Рейсы» |
| `userfieldconfig.list` | `scripts/b24-setup.ts` | вебхук | 📄 | `entityId` смарт-процесса — `CRM_<id типа>` |
| `userfieldconfig.add` | `shared/b24Setup.ts` | вебхук | 📄 | код поля `UF_CRM_<id типа>_<POSTFIX>` |
| `crm.category.list` | `scripts/b24-setup.ts`, `server/services/b24Orders.ts` | вебхук | 📄 | ответ `result.categories[]` |
| `crm.category.add` | `shared/b24Setup.ts` | вебхук | 📄 | воронка сделок «Заявки ЛК», `entityTypeId: 2` |
| `crm.item.fields` | `server/services/b24Access.ts`, `b24Orders.ts` | вебхук | 📄 | ключи UF в `crm.item.*` — camelCase, правило не описано: ищем по исходному коду поля |
| `crm.duplicate.findbycomm` | `server/services/b24Access.ts` | вебхук | 📄 | контакт по телефону/email; до 20 значений; пустой ответ — массив, не объект; телефон шлём в двух записях (с «+» и без) — как CRM хранит «+», не описано |
| `crm.item.list` | `server/services/b24Access.ts`, `b24Companies.ts`, `b24Orders.ts` | вебхук | 📄 | «Доступ в ЛК» по одному `contactId` (оператор «в списке» не описан); компания по `UF_CRM_1C_GUID`; «Рейсы» — всё расписание (одна запись на город), пропуск кривых строк с записью в журнал; результат перепроверяем |
| `crm.item.get` | `server/services/b24Access.ts`, `server/api/callback.post.ts` | вебхук | 📄 | запись доступа; компания (`entityTypeId: 4`) — название и `UF_CRM_1C_GUID`. «Нет записи» — только NOT_FOUND; прочие сбои пробрасываются (иначе простой CRM = отзыв ключа); контакт (`entityTypeId: 3`) — имя для «Заказать звонок» |
| `crm.item.add` | `server/services/b24Access.ts`, `b24Companies.ts` | вебхук | 📄 | новая запись доступа с `contactId`, `companyId`; новая компания из 1С |
| `crm.item.update` | `server/services/b24Access.ts` | вебхук | 📄 | перевыпуск, отзыв, последний вход |
| `crm.contact.company.items.get` | `server/services/b24Access.ts` | вебхук | 📄 | ключ выдаётся только контакту, привязанному к компании |
| `user.get` | `server/services/b24Companies.ts` | вебхук | 📄 | ответственный по email менеджера из 1С; результат перепроверяем — фильтр могут проигнорировать |
| `crm.deal.list` | `server/services/b24Orders.ts` | вебхук | 📄 | поиск сделки по `ORIGINATOR_ID` + `ORIGIN_ID` — повторная отправка заявки не плодит сделок; совпадение перепроверяем |
| `crm.deal.add` | `server/services/b24Orders.ts` | вебхук | 📄 | заявка: воронка «Заявки ЛК», `COMPANY_ID`, `CONTACT_IDS`; `COMMENTS` поддерживает BB-коды — текст клиента обезврежен (`neutralizeBb`) |
| `crm.deal.productrows.set` | `server/services/b24Orders.ts` | вебхук | 📄 | товары без каталога Б24 (`PRODUCT_ID: 0`), цена 1С с НДС — `TAX_INCLUDED: 'Y'`; перезаписывает строки целиком, повтор безопасен |
| `crm.activity.todo.add` | `server/services/b24Orders.ts` | вебхук | 📄 | «Заказать звонок»: дело на компании (`ownerTypeId: 4`) ответственному, срок +1 ч; ответ `{ id }` |

## Что вебхуком не делается

`placement.bind` (вкладка `CRM_COMPANY_DETAIL_TAB`) и `event.bind` требуют контекста приложения:
документация `placement.bind` прямо называет ошибку `WRONG_AUTH_TYPE … Application context
required`. Поэтому скрипт настройки их не регистрирует — это делает установка приложения на
этапе 2 (`docs/plan.md`).
