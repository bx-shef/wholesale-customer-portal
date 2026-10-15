/**
 * Цены клиента (docs/onec-contract.md §2.4, §1.8): прайс по видам цен лежит в базе ЛК, его
 * обновляет расписание по изменениям. Цена клиента = строка прайса по виду цен его договора,
 * договор — из клиентов 1С (§2.1). На показ цены в 1С не ходим вовсе.
 *
 * Чужую цену клиент не увидит: `clientGuid` берётся только из CRM по компании сессии.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { PriceT } from '../../shared/onec/schemas'

export function createPriceStore(db: DatabaseSync) {
  const upsert = db.prepare(`INSERT INTO price_list (price_type_guid, item_guid, price, currency, vat_rate, changed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (price_type_guid, item_guid) DO UPDATE SET price = excluded.price, currency = excluded.currency,
      vat_rate = excluded.vat_rate, changed_at = excluded.changed_at`)
  const remove = db.prepare('DELETE FROM price_list WHERE price_type_guid = ? AND item_guid = ?')
  const contractOf = db.prepare('SELECT contract FROM onec_client WHERE guid = ? AND deleted = 0')
  const lower = (s: string) => s.toLowerCase()

  return {
    save(rows: PriceT[]) {
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const r of rows) {
          if (r.deleted) remove.run(lower(r.priceTypeGuid), lower(r.itemGuid))
          else upsert.run(lower(r.priceTypeGuid), lower(r.itemGuid), r.price, r.currency, r.vatRate, r.changedAt)
        }
        db.exec('COMMIT')
      }
      catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    /** Вид цен договора клиента; нет клиента или договора — null. */
    priceTypeOf(clientGuid: string): string | null {
      const row = contractOf.get(lower(clientGuid)) as { contract: string | null } | undefined
      const contract = row?.contract ? JSON.parse(row.contract) as { priceTypeGuid?: string } : null
      return contract?.priceTypeGuid ? lower(contract.priceTypeGuid) : null
    },
    /** Цены товаров для клиента по его договору; товара без цены в ответе нет. */
    async get(clientGuid: string, itemGuids: string[]): Promise<Map<string, PriceT>> {
      const out = new Map<string, PriceT>()
      const priceType = this.priceTypeOf(clientGuid)
      const wanted = [...new Set(itemGuids.map(lower))]
      if (!priceType || wanted.length === 0) return out
      const rows = db.prepare(`SELECT item_guid AS itemGuid, price, currency, vat_rate AS vatRate, changed_at AS changedAt
        FROM price_list WHERE price_type_guid = ? AND item_guid IN (${wanted.map(() => '?').join(',')})`)
        .all(priceType, ...wanted) as { itemGuid: string, price: number, currency: string, vatRate: number, changedAt: string }[]
      for (const r of rows) out.set(r.itemGuid, { ...r, priceTypeGuid: priceType, deleted: false })
      return out
    },
  }
}

export type PriceStore = ReturnType<typeof createPriceStore>
