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
]

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): number {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    }
    catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return MIGRATIONS.length
}
