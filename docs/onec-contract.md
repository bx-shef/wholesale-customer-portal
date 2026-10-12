# Задание программисту 1С: HTTP-сервис для ЛК

> Last reviewed: 2026-10-12

Сервис (расширение конфигурации) отдаёт данные ЛК и принимает заказы. В прототипе этот же контракт реализует мок `server/routes/mock-1c/*`; приёмка — прохождение тех же контрактных тестов на тестовой базе 1С.

## Общие требования

- HTTPS, `Authorization: Bearer <token>`; доступ только с сервера ЛК (VPN или белый список IP).
- JSON в UTF-8, даты ISO 8601, суммы — число с двумя знаками, идентификаторы — GUID ссылок 1С.
- Ошибка — HTTP-код и `{"error": "<код>", "message": "<текст>"}`. Коды: `unauthorized` (401), `validation` (400), `not_found` (404), `conflict` (409), `unavailable` (503 — ЛК повторит), `internal` (500).
- Списки — страницами: `page`, `pageSize` (до 500; больше — **обязательно** 400, это проверяет контрактный тест). Ответ — объект `{"items": [...], "nextPage": <номер> | null}`; у `/catalog` ещё `sections` (целиком на первой странице, на остальных — пустой массив).
- Порядок строк в списке — по `changedAt`, затем по GUID: иначе страницы «поплывут» между запросами.
- `changedSince` — всё изменённое **начиная с** момента (граница включительно), включая пометку удаления (`deleted: true`). ЛК читает по ключу: следующий запрос — `changedSince` = `changedAt` последней полученной строки. Поэтому `changedAt` — время 1С, монотонное, лучше с миллисекундами; строки на границе ЛК получает повторно и снимает по GUID.

## Методы

| Метод | Запрос | Ответ (основные поля) |
| --- | --- | --- |
| `GET /clients` | `changedSince`, `page` | `items[]`: `guid`, `name`, `unp` (ИНН/УНП), `address`, `city`, `managerEmail`, `contractGuid`, `deliveryAddresses[]` (`guid`, `city`, `address`), `changedAt`, `deleted` |
| `GET /client/{guid}/contract` | — | `guid`, `number`, `date`, `priceTypeGuid`, `paymentDelayDays`, `creditLimit`, `debt`, `currency` |
| `GET /catalog` | `changedSince`, `page` | `sections[]` (`guid`, `parentGuid`, `name`); `items[]` (`guid`, `sku`, `name`, `sectionGuid`, `brand`, `unit`, `packQty`, `minQty`, `description`, `properties{}`, `images[]`, `analogs[]`, `changedAt`, `deleted`) |
| `POST /prices` | `clientGuid`, `items[]` (GUID, до 500) | `[{itemGuid, price, currency, vatRate}]` — цена по договору клиента, с НДС; неизвестного товара в ответе просто нет |
| `GET /stock` | `changedSince`, `page` | `items[]`: `[{itemGuid, warehouseGuid, warehouseName, available, changedAt}]` — свободный остаток без резервов. Товар ушёл со склада — строка с `available: 0` и новым `changedAt`, а не пропажа строки: ЛК обновляет только пришедшее |
| `POST /order` | `externalId` (ID сделки Б24), `clientGuid`, `contractGuid`, `deliveryAddressGuid`, `deliveryDate`, `comment`, `items[]` (`itemGuid`, `qty`, `price`) | `orderGuid`, `number`, `status`; 201 — создан. Повтор с тем же `externalId` — 200 и уже созданный заказ (**обязательно**: ЛК повторяет запрос после таймаута). Тот же `externalId` от другого клиента — 409. Договор или адрес не этого клиента — 400 |
| `GET /orders/status` | `changedSince`, `page` | `items[]`: `[{orderGuid, externalId, number, status, shipmentDate, changedAt}]`; `status`: `new`, `confirmed`, `assembled`, `shipped`, `delivered`, `cancelled` |

## Точная форма — OpenAPI

[`contracts/onec.openapi.yaml`](../contracts/onec.openapi.yaml) — типы полей, обязательность, коды
ответов. Файл собирается из `shared/onec/schemas.ts` (`pnpm onec:openapi`), руками не правится.
Расхождение таблицы выше и OpenAPI — ошибка; верен OpenAPI.

## Мок и тесты — для программиста 1С

**Мок** отвечает ровно по контракту и показывает, как ЛК ждёт ответов:

```bash
curl -H "Authorization: Bearer $TOKEN" "https://wsp.algena.by/mock-1c/clients?pageSize=2"
```

Адрес — стенд ЛК (`docs/DEPLOY.md`), токен — `ONEC_TOKEN` стенда, выдаёт владелец. Без
`ONEC_TOKEN` мок снаружи закрыт. Данные детерминированные: 5 клиентов, 3 типа цен, 2 склада,
12 разделов, 500 товаров. Остатки меняются между запросами, заказ сам проходит статусы
`new → confirmed (1 мин) → assembled (3) → shipped (5) → delivered (10)`.

Управление моком (тот же токен, не часть контракта 1С):

| Запрос | Что делает |
| --- | --- |
| `POST /mock-1c/_admin/reset` `{"seed": 1}` | вернуть исходные данные |
| `POST /mock-1c/_admin/client` `{"name": "…"}` | «завести» нового клиента в 1С |
| `POST /mock-1c/_admin/mode` `{"delayMs": 2000, "failRate": 0.2, "failNext": 3}` | задержка и ответы 503 |
| `POST /mock-1c/_admin/cancel` `{"orderGuid": "…"}` | отменить заказ |

**Контрактные тесты** — те же, что гоняет CI против мока. Приёмка сервиса — их прохождение на
тестовой базе:

```bash
git clone https://github.com/bx-shef/wholesale-customer-portal && cd wholesale-customer-portal
pnpm install
ONEC_CONTRACT_URL=https://<1С>/hs/lk ONEC_CONTRACT_TOKEN=<токен> pnpm test:contract
# + ONEC_CONTRACT_ALLOW_ORDER=1 — проверить и создание заказа (пишет в базу)
```

## Порядок сдачи

1. `GET /clients`, `GET /client/{guid}/contract` — к концу этапа 2 ЛК.
2. `GET /catalog`, `POST /prices`, `GET /stock` — этап 3 (ЛК их уже вызывает, на моке).
3. `POST /order`, `GET /orders/status` — этап 4.
4. Прогон контрактных тестов на тестовой базе — этап 5–6.

Вопросы и расхождения с контрактом — issue в этом репозитории с меткой контракта; контракт меняется только PR.
