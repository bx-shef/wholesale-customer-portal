/**
 * Очистка данных обмена при переходе с мока на настоящую 1С (2026-10-23): ЛК не удаляет товары и
 * цены, пропавшие из выдачи OData (docs/onec-odata.md, «Пропавшее из 1С»), поэтому без очистки
 * 500 демо-товаров мока остались бы в каталоге клиентов рядом с настоящими.
 * Стирает только то, что заново приходит из 1С; заявки, ключи, журналы входов и ИИ не трогает.
 */
import type { DatabaseSync } from 'node:sqlite'

/** Таблицы, которые целиком наполняет обмен с 1С. */
export const SYNC_DATA_TABLES = ['catalog_item', 'catalog_section', 'stock', 'price_list', 'delivery_schedule', 'trip', 'onec_client', 'odata_version'] as const
/** Курсоры этих потоков: без сброса первая выгрузка взяла бы только «изменённое после мока». */
export const SYNC_DATA_FLOWS = ['catalog', 'prices', 'stock', 'schedule', 'trips', 'client_data'] as const

export function resetSyncData(db: DatabaseSync): Record<string, number> {
  const removed: Record<string, number> = {}
  db.exec('BEGIN')
  try {
    for (const t of SYNC_DATA_TABLES) removed[t] = Number(db.prepare(`DELETE FROM ${t}`).run().changes)
    const cursor = db.prepare('DELETE FROM sync_cursor WHERE flow = ?')
    for (const f of SYNC_DATA_FLOWS) cursor.run(f)
    db.exec('COMMIT')
  }
  catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return removed
}
