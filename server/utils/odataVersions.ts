// Версии объектов 1С по OData в SQLite (таблица odata_version): по ним ЛК ведёт момент изменения.
import type { DatabaseSync } from 'node:sqlite'
import type { VersionStore } from '../services/onecOdataSource'
import type { VersionMark } from './odataSnapshot'

export function sqliteVersionStore(db: DatabaseSync): VersionStore {
  const select = db.prepare('SELECT key, version, changed_at AS changedAt FROM odata_version WHERE kind = ?')
  const upsert = db.prepare(`INSERT INTO odata_version (kind, key, version, changed_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (kind, key) DO UPDATE SET version = excluded.version, changed_at = excluded.changed_at`)
  return {
    get(kind) {
      const rows = select.all(kind) as unknown as Array<{ key: string } & VersionMark>
      return new Map(rows.map(r => [r.key, { version: r.version, changedAt: r.changedAt }]))
    },
    put(kind, updates) {
      if (!updates.length) return
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const u of updates) upsert.run(kind, u.key, u.version, u.changedAt)
        db.exec('COMMIT')
      }
      catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}
