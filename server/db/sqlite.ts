/**
 * Постоянное хранилище ЛК — SQLite из Node (`node:sqlite`), файл на томе `/data` (DATA_DIR).
 * Без новых зависимостей и без отдельного сервиса: контейнер остаётся read_only, пишется только
 * том (docs/DEPLOY.md). Что здесь живёт — курсоры и журнал синхронизации с 1С, журнал входов;
 * данные клиентов (компании, ключи доступа) — в CRM Б24, не здесь (docs/spec.md §3).
 *
 * Схема — упорядоченный список миграций; применённые помнит `PRAGMA user_version`, поэтому
 * старт идемпотентен, а новая миграция дописывается в конец и никогда не правится задним числом.
 */
import { DatabaseSync } from 'node:sqlite'

export const MIGRATIONS: string[] = [
  `CREATE TABLE sync_cursor (
     flow TEXT PRIMARY KEY,
     cursor TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE sync_run (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     flow TEXT NOT NULL,
     status TEXT NOT NULL,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     cursor_from TEXT,
     cursor_to TEXT,
     received INTEGER NOT NULL DEFAULT 0,
     error TEXT
   );
   CREATE INDEX sync_run_flow ON sync_run (flow, started_at);
   CREATE TABLE login_journal (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     login_hash TEXT NOT NULL,
     ip TEXT NOT NULL,
     ok INTEGER NOT NULL,
     reason TEXT NOT NULL,
     contact_id INTEGER,
     company_id INTEGER
   );
   CREATE INDEX login_journal_login ON login_journal (login_hash, at);
   CREATE INDEX login_journal_ip ON login_journal (ip, at);`,
  // Этап 3: индекс каталога и остатков из 1С. Цены не храним — они по клиенту, в кэше процесса.
  `CREATE TABLE catalog_section (
     guid TEXT PRIMARY KEY,
     parent_guid TEXT,
     name TEXT NOT NULL
   );
   CREATE TABLE catalog_item (
     guid TEXT PRIMARY KEY,
     sku TEXT NOT NULL,
     name TEXT NOT NULL,
     section_guid TEXT NOT NULL,
     brand TEXT NOT NULL,
     unit TEXT NOT NULL,
     pack_qty REAL NOT NULL,
     min_qty REAL NOT NULL,
     description TEXT NOT NULL,
     properties TEXT NOT NULL,
     images TEXT NOT NULL,
     analogs TEXT NOT NULL,
     search TEXT NOT NULL,
     name_sort TEXT NOT NULL,
     changed_at TEXT NOT NULL
   );
   CREATE INDEX catalog_item_section ON catalog_item (section_guid);
   CREATE INDEX catalog_item_brand ON catalog_item (brand);
   CREATE INDEX catalog_item_name_sort ON catalog_item (name_sort);
   CREATE TABLE stock (
     item_guid TEXT NOT NULL,
     warehouse_guid TEXT NOT NULL,
     warehouse_name TEXT NOT NULL,
     available REAL NOT NULL,
     changed_at TEXT NOT NULL,
     PRIMARY KEY (item_guid, warehouse_guid)
   );`,
  // Этап 4: клиенты 1С (договор и адреса доставки) и заявки ЛК — по ним «Мои заявки» и заказ в 1С.
  `CREATE TABLE onec_client (
     guid TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     contract_guid TEXT,
     addresses TEXT NOT NULL,
     deleted INTEGER NOT NULL,
     changed_at TEXT NOT NULL
   );
   CREATE TABLE order_request (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     request_id TEXT NOT NULL UNIQUE,
     company_id INTEGER NOT NULL,
     contact_id INTEGER NOT NULL,
     client_guid TEXT NOT NULL,
     contract_guid TEXT NOT NULL,
     address_guid TEXT NOT NULL,
     address_text TEXT NOT NULL,
     delivery_from TEXT,
     delivery_to TEXT,
     payload_hash TEXT NOT NULL,
     items TEXT NOT NULL,
     total REAL NOT NULL,
     currency TEXT NOT NULL,
     comment TEXT NOT NULL,
     deal_id INTEGER,
     status TEXT NOT NULL,
     sending_at TEXT,
     onec_order_guid TEXT,
     onec_number TEXT,
     shipment_date TEXT,
     error TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX order_request_company ON order_request (company_id, created_at);
   CREATE INDEX order_request_status ON order_request (status);`,
  // Этап 4б: что уже сообщено в сделку (повтор после сбоя CRM) и когда сделку проверяли (очередь по кругу).
  `ALTER TABLE order_request ADD COLUMN crm_status TEXT;
   ALTER TABLE order_request ADD COLUMN checked_at TEXT;
   ALTER TABLE order_request ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX order_request_checked ON order_request (status, checked_at);`,
  // Локальное приложение коробки вместо входящего вебхука: токены, выданные при установке, и их
  // продление. Строка одна — портал у ЛК один (docs/spec.md §2).
  `CREATE TABLE b24_app_auth (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     domain TEXT NOT NULL,
     member_id TEXT NOT NULL,
     access_token TEXT NOT NULL,
     refresh_token TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     server_endpoint TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // Этап 5: журнал диалогов ИИ-помощника и оценка ответа клиентом (👍/👎). Хранится 90 дней.
  `CREATE TABLE ai_dialog (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     created_at TEXT NOT NULL,
     company_id INTEGER NOT NULL,
     contact_id INTEGER NOT NULL,
     question TEXT NOT NULL,
     answer TEXT,
     products TEXT NOT NULL DEFAULT '[]',
     topic TEXT,
     status TEXT NOT NULL DEFAULT 'started',
     rating INTEGER,
     rated_at TEXT
   );
   CREATE INDEX ai_dialog_created ON ai_dialog (created_at);`,
  // Обмен с 1С без запросов на показ (docs/onec-contract.md §1.8): договор — внутри клиента,
  // прайс по видам цен — своей таблицей; цена клиента считается в ЛК.
  `ALTER TABLE onec_client ADD COLUMN contract TEXT;
   CREATE TABLE price_list (
     price_type_guid TEXT NOT NULL,
     item_guid TEXT NOT NULL,
     price REAL NOT NULL,
     currency TEXT NOT NULL,
     vat_rate REAL NOT NULL,
     changed_at TEXT NOT NULL,
     PRIMARY KEY (price_type_guid, item_guid)
   );
   -- Клиенты, загруженные до договора внутри /clients, перечитать целиком: иначе у них нет вида цен.
   DELETE FROM sync_cursor WHERE flow = 'clients';`,
  // Состояние фоновых задач, которое должно пережить выкат (эпизоды оповещений).
  `CREATE TABLE app_state (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  // Доставка ведётся в 1С (решение владельца 2026-10-19): регион клиента, график по регионам,
  // задания на перевозку — ЛК только читает (docs/onec-contract.md §2.1, §2.8, §2.9).
  `ALTER TABLE onec_client ADD COLUMN region_guid TEXT;
   ALTER TABLE onec_client ADD COLUMN region_name TEXT;
   ALTER TABLE onec_client ADD COLUMN shipment_blocked INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE order_request ADD COLUMN trip_guid TEXT;
   CREATE TABLE delivery_schedule (
     region_guid TEXT PRIMARY KEY,
     region_name TEXT NOT NULL,
     data TEXT NOT NULL
   );
   CREATE TABLE trip (
     guid TEXT PRIMARY KEY,
     number TEXT NOT NULL,
     status TEXT NOT NULL,
     planned_start TEXT NOT NULL,
     data TEXT NOT NULL,
     changed_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX trip_planned ON trip (planned_start);
   -- Регион и запрет отгрузки — у всех клиентов, а не только изменённых: перечитать целиком.
   DELETE FROM sync_cursor WHERE flow = 'clients';`,
  // 1С по OData (docs/onec-odata.md): у объектов нет даты изменения — момент изменения ЛК ведёт сам
  // по версии объекта (`DataVersion`): версия та же — прежний момент, новая — момент прогона.
  `CREATE TABLE odata_version (
     kind TEXT NOT NULL,
     key TEXT NOT NULL,
     version TEXT NOT NULL,
     changed_at TEXT NOT NULL,
     PRIMARY KEY (kind, key)
   );`,
  // Данные клиента грузятся из 1С по его GUID при входе и по расписанию (решение владельца
  // 2026-10-22): когда загружены и когда клиент последний раз заходил.
  `ALTER TABLE onec_client ADD COLUMN loaded_at TEXT;
   ALTER TABLE onec_client ADD COLUMN seen_at TEXT;`,
]

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync, migrations: readonly string[] = MIGRATIONS): number {
  const version = () => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (;;) {
    // IMMEDIATE + перечитать версию внутри: два процесса на старте не применят миграцию дважды.
    db.exec('BEGIN IMMEDIATE')
    try {
      const v = version()
      if (v >= migrations.length) {
        db.exec('COMMIT')
        return migrations.length
      }
      db.exec(migrations[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    }
    catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}
