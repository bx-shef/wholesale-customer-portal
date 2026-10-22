/**
 * OpenAPI контракта 1С из zod-схем: файл `contracts/onec.openapi.yaml` для программиста 1С
 * собирается отсюда (`pnpm onec:openapi`), а `tests/onecOpenapi.test.ts` краснеет, если файл
 * отстал от схем. Вторая, рукописная копия контракта разошлась бы молча.
 */
import { z } from 'zod'
import * as s from './schemas'

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' })
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const content = (name: string) => ({ 'application/json': { schema: ref(name) } })
const errors = {
  400: { description: 'Неверные параметры', content: content('Error') },
  401: { description: 'Нет или неверный Bearer-токен', content: content('Error') },
  503: { description: 'Сервис временно недоступен — ЛК повторит запрос', content: content('Error') },
}
const listParams = [
  { name: 'changedSince', in: 'query', required: false, schema: { type: 'string', format: 'date-time' }, description: 'Только изменённое строго позже этого момента, включая пометку удаления' },
  { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'pageSize', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: s.PAGE_SIZE_MAX, default: s.PAGE_SIZE_MAX } },
]

export function buildOnecOpenApi() {
  const schemas = {
    Error: s.ErrorBody, Client: s.Client, ClientsPage: s.ClientsPage, Contract: s.Contract, Section: s.Section,
    Item: s.Item, CatalogPage: s.CatalogPage, Price: s.Price, PricesPage: s.PricesPage, OrderLineFact: s.OrderLineFact,
    Stock: s.Stock, StockPage: s.StockPage, OrderRequest: s.OrderRequest, OrderCreated: s.OrderCreated,
    OrderStatusRow: s.OrderStatusRow, OrderStatusPage: s.OrderStatusPage, DeliverySchedule: s.DeliverySchedule, DeliverySchedulePage: s.DeliverySchedulePage, Trip: s.Trip, TripsPage: s.TripsPage, ImageRef: s.ImageRef, ImageFile: s.ImageFile,
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'HTTP-сервис 1С для ЛК опта',
      version: '1.0.0',
      description: 'Собрано из shared/onec/schemas.ts. Описание и порядок сдачи — docs/onec-contract.md. Не править руками: pnpm onec:openapi.',
    },
    security: [{ bearer: [] }, { basic: [] }],
    paths: {
      '/clients': { get: { summary: 'Контрагенты с договорами и адресами доставки', parameters: listParams, responses: { 200: { description: 'Страница', content: content('ClientsPage') }, ...errors } } },
      '/client/{guid}': {
        get: {
          summary: 'Один клиент по GUID: договор, адреса, регион — ЛК грузит его при входе и по расписанию',
          parameters: [{ name: 'guid', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Клиент', content: content('Client') }, 404: { description: 'Нет такого клиента', content: content('Error') }, ...errors },
        },
      },
      '/image/{id}': {
        get: {
          summary: 'Картинка товара в base64 (JPEG, PNG, WebP; до 5 МБ)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' } }],
          responses: { 200: { description: 'Файл', content: content('ImageFile') }, 404: { description: 'Нет картинки', content: content('Error') }, ...errors },
        },
      },
      '/catalog': { get: { summary: 'Каталог: разделы (виды номенклатуры) на первой странице, товары постранично', parameters: listParams, responses: { 200: { description: 'Страница', content: content('CatalogPage') }, ...errors } } },
      '/prices': { get: { summary: 'Прайс: цены по видам цен, с НДС, по изменениям', parameters: listParams, responses: { 200: { description: 'Страница', content: content('PricesPage') }, ...errors } } },
      '/stock': { get: { summary: 'Свободный остаток без резервов', parameters: listParams, responses: { 200: { description: 'Страница', content: content('StockPage') }, ...errors } } },
      '/order': {
        post: {
          summary: 'Заказ. Повтор с тем же externalId возвращает уже созданный заказ',
          requestBody: { required: true, content: content('OrderRequest') },
          responses: {
            201: { description: 'Создан', content: content('OrderCreated') },
            200: { description: 'Уже был создан с этим externalId', content: content('OrderCreated') },
            404: { description: 'Нет клиента', content: content('Error') },
            ...errors,
          },
        },
      },
      '/orders/status': { get: { summary: 'Статусы заказов', parameters: listParams, responses: { 200: { description: 'Страница', content: content('OrderStatusPage') }, ...errors } } },
      '/delivery-schedule': { get: { summary: 'График доставки по бизнес-регионам, целиком (ведёт логист в 1С)', responses: { 200: { description: 'Весь график', content: content('DeliverySchedulePage') }, ...errors } } },
      '/trips': { get: { summary: 'Задания на перевозку (рейсы) по изменениям', parameters: listParams, responses: { 200: { description: 'Страница', content: content('TripsPage') }, ...errors } } },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, basic: { type: 'http', scheme: 'basic' } },
      schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, json(schema)])),
    },
  }
}
