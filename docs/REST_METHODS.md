# Исходящие вызовы REST Битрикс24

> Last reviewed: 2026-10-14

Реестр каждого метода, который зовёт ЛК. Добавили вызов в код — добавьте строку сюда:
`tests/repoGuards.test.ts` сверяет имена методов в `app/`, `server/`, `shared/`, `scripts/` с этим
файлом и краснеет на пропуске. Формат — из bx-shef/invoice-from-tasks.

Сигнатуры не дублируются: источник — MCP `b24-dev-mcp`. Здесь — кто зовёт, каким транспортом и
какие грабли уже известны.

**Транспорт.** «Приложение» — токен локального приложения коробки на сервере ЛК
(`server/utils/b24.ts`; вебхук отменён 14.10.2026, им пользуется только `pnpm b24:setup` на
тестовом стенде). «Приложение (фрейм)» — вызов из страницы встройки в браузере сотрудника.
«Токен фрейма сотрудника» — вызов сервера от имени менеджера, открывшего вкладку: его права CRM.

**Статус.** 📄 — сверено с документацией MCP, на живом портале не проверялось; ✅ — проверено на
тестовой коробке.

| Метод | Кто зовёт | Транспорт | Статус | Заметки |
| --- | --- | --- | --- | --- |
| `crm.company.userfield.list` | `shared/b24SetupRun.ts` | приложение | 📄 | ищем `UF_CRM_1C_GUID` |
| `crm.company.userfield.add` | `shared/b24Setup.ts` | приложение | 📄 | `FIELD_NAME` без префикса `UF_CRM_` — портал добавляет его сам |
| `crm.type.list` | `shared/b24SetupRun.ts`, `server/services/b24Access.ts`, `b24Orders.ts` | приложение | 📄 | ответ `result.types[]`; `id` типа ≠ `entityTypeId` |
| `crm.type.add` | `shared/b24Setup.ts` | приложение | 📄 | «Доступ в ЛК», «Рейсы» |
| `userfieldconfig.list` | `shared/b24SetupRun.ts` | приложение | 📄 | `entityId` смарт-процесса — `CRM_<id типа>` |
| `userfieldconfig.add` | `shared/b24Setup.ts` | приложение | 📄 | код поля `UF_CRM_<id типа>_<POSTFIX>` |
| `crm.category.list` | `shared/b24SetupRun.ts`, `server/services/b24Orders.ts` | приложение | 📄 | ответ `result.categories[]` |
| `crm.category.add` | `shared/b24Setup.ts` | приложение | 📄 | воронка сделок «Заявки ЛК», `entityTypeId: 2` |
| `crm.item.fields` | `server/services/b24Access.ts`, `b24Orders.ts` | приложение | 📄 | ключи UF в `crm.item.*` — camelCase, правило не описано: ищем по исходному коду поля |
| `crm.duplicate.findbycomm` | `server/services/b24Access.ts` | приложение | 📄 | контакт по телефону/email; до 20 значений; пустой ответ — массив, не объект; телефон шлём в двух записях (с «+» и без) — как CRM хранит «+», не описано |
| `crm.item.list` | `server/services/b24Access.ts`, `b24Companies.ts`, `b24Orders.ts` | приложение | 📄 | «Доступ в ЛК» по одному `contactId` (оператор «в списке» не описан); компания по `UF_CRM_1C_GUID`; «Рейсы» — всё расписание (одна запись на город), пропуск кривых строк с записью в журнал; результат перепроверяем |
| `crm.item.get` | `server/services/b24Access.ts`, `b24Orders.ts`, `server/api/callback.post.ts` | приложение | 📄 | запись доступа; компания (`entityTypeId: 4`) — название и `UF_CRM_1C_GUID`. «Нет записи» — только NOT_FOUND; прочие сбои пробрасываются (иначе простой CRM = отзыв ключа); контакт (`entityTypeId: 3`) — имя для «Заказать звонок»; сделка (`entityTypeId: 2`) — `stageId` |
| `crm.item.add` | `server/services/b24Access.ts`, `b24Companies.ts` | приложение | 📄 | новая запись доступа с `contactId`, `companyId`; новая компания из 1С |
| `crm.item.update` | `server/services/b24Access.ts`, `b24Orders.ts` | приложение | 📄 | перевыпуск, отзыв, последний вход; стадия сделки при закрытии заказа 1С |
| `crm.contact.company.items.get` | `server/services/b24Access.ts` | приложение | 📄 | ключ выдаётся только контакту, привязанному к компании |
| `user.get` | `server/services/b24Companies.ts` | приложение | 📄 | ответственный по email менеджера из 1С; результат перепроверяем — фильтр могут проигнорировать |
| `crm.deal.list` | `server/services/b24Orders.ts` | приложение | 📄 | поиск сделки по `ORIGINATOR_ID` + `ORIGIN_ID` — повторная отправка заявки не плодит сделок; совпадение перепроверяем |
| `crm.deal.add` | `server/services/b24Orders.ts` | приложение | 📄 | заявка: воронка «Заявки ЛК», `COMPANY_ID`, `CONTACT_IDS`; `COMMENTS` поддерживает BB-коды — текст клиента обезврежен (`neutralizeBb`) |
| `crm.deal.productrows.set` | `server/services/b24Orders.ts` | приложение | 📄 | товары без каталога Б24 (`PRODUCT_ID: 0`), цена 1С с НДС — `TAX_INCLUDED: 'Y'`; перезаписывает строки целиком, повтор безопасен |
| `crm.activity.todo.add` | `server/services/b24Orders.ts` | приложение | 📄 | «Заказать звонок»: дело на компании (`ownerTypeId: 4`) ответственному, срок +1 ч; ответ `{ id }` |
| `crm.status.list` | `server/services/b24Orders.ts` | приложение | 📄 | стадии воронки «Заявки ЛК»: `ENTITY_ID: DEAL_STAGE_<id воронки>`, семантика из `SEMANTICS` / `EXTRA.SEMANTICS` (рабочая, успех, провал) — по ней, а не по шаблону ID стадии, решаем «подтверждена» и «закрыта» |
| `crm.timeline.comment.add` | `server/services/b24Orders.ts` | приложение | 📄 | комментарий в ленте сделки: заказ 1С создан, статус из 1С (`ENTITY_TYPE: 'deal'`) |
| `crm.company.contact.items.get` | `server/services/b24Access.ts` | токен фрейма сотрудника | 📄 | контакты компании для вкладки; несуществующая компания — пустой массив, не ошибка |
| `crm.contact.get` | `server/services/b24Access.ts` | токен фрейма сотрудника | 📄 | имя, `PHONE[]`, `EMAIL[]` (мультиполя `{ VALUE }`) контакта для вкладки |
| `crm.company.get` | `server/utils/managerTab.ts` | токен фрейма сотрудника | 📄 | сотрудник видит компанию; сверяем `ID`, `ASSIGNED_BY_ID` — ответственный |
| `user.current` | `server/utils/managerTab.ts` | токен фрейма сотрудника | 📄 | кто открыл вкладку: `ID` сверяем с ответственным за компанию |
| `user.admin` | `server/utils/managerTab.ts` | токен фрейма сотрудника | 📄 | администратор портала выдаёт ключи и не будучи ответственным; ответ — `true`/`false` |
| `placement.unbind` | `app/pages/b24/install.vue` | приложение (фрейм) | 📄 | перед `bind` при переустановке — сменить обработчик иначе нельзя; ошибку глотаем |
| `placement.bind` | `app/pages/b24/install.vue` | приложение (фрейм) | 📄 | вкладка `CRM_COMPANY_DETAIL_TAB` «Личный кабинет»; вебхуком нельзя (`WRONG_AUTH_TYPE`) |

## Долг: устаревшие методы

Документация (MCP `b24-dev-mcp`, карточки `crm.deal.get`, `crm.deal.fields`) помечает `crm.deal.*`
как DEPRECATED: «развитие метода остановлено», рекомендован `crm.item.*`. Заявки этапа 4а создаются
через `crm.deal.list`, `crm.deal.add`, `crm.deal.productrows.set` — они работают, но это долг:
перейти на `crm.item.list`/`crm.item.add` с `entityTypeId: 2` и `crm.item.productrow.set` с проверкой
на коробке и тестом идемпотентности по `originatorId`/`originId` — до пилота (этап 7). Новые вызовы
этапа 4б (стадия сделки, перевод стадии) уже идут через `crm.item.*`.

## Что делается только из контекста приложения

`placement.bind` (вкладка `CRM_COMPANY_DETAIL_TAB`) и `event.bind` требуют контекста приложения:
документация `placement.bind` прямо называет ошибку `WRONG_AUTH_TYPE … Application context
required`. Вкладку ставит страница установки локального приложения `/b24/install` (`docs/DEPLOY_BITRIXVM.md`).
