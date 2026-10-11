# Задание программисту 1С: HTTP-сервис для ЛК

Сервис (расширение конфигурации) отдаёт данные ЛК и принимает заказы. В прототипе этот же контракт реализует мок `server/routes/mock-1c/*`; приёмка — прохождение тех же контрактных тестов на тестовой базе 1С.

## Общие требования

- HTTPS, `Authorization: Bearer <token>`; доступ только с сервера ЛК (VPN или белый список IP).
- JSON в UTF-8, даты ISO 8601, суммы — число с двумя знаками, идентификаторы — GUID ссылок 1С.
- Ошибка — HTTP-код и `{"error": "<код>", "message": "<текст>"}`.
- Списки — страницами: `page`, `pageSize` (до 500), в ответе `nextPage` (null на последней).
- `changedSince` — всё изменённое после момента, включая пометку удаления (`deleted: true`).

## Методы

| Метод | Запрос | Ответ (основные поля) |
| --- | --- | --- |
| `GET /clients` | `changedSince`, `page` | `guid`, `name`, `unp` (ИНН/УНП), `address`, `city`, `managerEmail`, `contractGuid`, `deliveryAddresses[]` (`guid`, `city`, `address`), `changedAt`, `deleted` |
| `GET /client/{guid}/contract` | — | `guid`, `number`, `date`, `priceTypeGuid`, `paymentDelayDays`, `creditLimit`, `debt`, `currency` |
| `GET /catalog` | `changedSince`, `page` | `sections[]` (`guid`, `parentGuid`, `name`); `items[]` (`guid`, `sku`, `name`, `sectionGuid`, `brand`, `unit`, `packQty`, `minQty`, `description`, `properties{}`, `images[]`, `analogs[]`, `changedAt`, `deleted`) |
| `POST /prices` | `clientGuid`, `items[]` (GUID, до 500) | `[{itemGuid, price, currency, vatRate}]` — цена по договору клиента, с НДС |
| `GET /stock` | `changedSince`, `page` | `[{itemGuid, warehouseGuid, warehouseName, available, changedAt}]` — свободный остаток без резервов |
| `POST /order` | `externalId` (ID сделки Б24), `clientGuid`, `contractGuid`, `deliveryAddressGuid`, `deliveryDate`, `comment`, `items[]` (`itemGuid`, `qty`, `price`) | `orderGuid`, `number`, `status`. Повтор с тем же `externalId` возвращает уже созданный заказ |
| `GET /orders/status` | `changedSince`, `page` | `[{orderGuid, externalId, number, status, shipmentDate, changedAt}]`; `status`: `new`, `confirmed`, `assembled`, `shipped`, `delivered`, `cancelled` |

## Порядок сдачи

1. `GET /clients`, `GET /client/{guid}/contract` — к концу этапа 2 ЛК.
2. `GET /catalog`, `POST /prices`, `GET /stock` — этап 3.
3. `POST /order`, `GET /orders/status` — этап 4.
4. Прогон контрактных тестов на тестовой базе — этап 5–6.

Вопросы и расхождения с контрактом — issue в этом репозитории с меткой контракта; контракт меняется только PR.
