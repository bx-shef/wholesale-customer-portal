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
  const contractOf = db.prepare('SELECT contract, contracts FROM onec_client WHERE guid = ? AND deleted = 0')
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
    /**
     * Вид цен соглашения клиента: выбранного (`contractGuid`), если оно из его действующих, иначе
     * основного (#46). Нет клиента или соглашения — null. Чужое соглашение не подставить: ищем
     * только среди соглашений этого клиента.
     */
    priceTypeOf(clientGuid: string, contractGuid?: string | null): string | null {
      const row = contractOf.get(lower(clientGuid)) as { contract: string | null, contracts: string | null } | undefined
      if (!row) return null
      const main = row.contract ? JSON.parse(row.contract) as { guid: string, priceTypeGuid?: string } : null
      const all = row.contracts ? JSON.parse(row.contracts) as { guid: string, priceTypeGuid?: string }[] : []
      const wanted = contractGuid ? all.find(c => lower(c.guid) === lower(contractGuid)) : undefined
      const contract = wanted ?? main
      return contract?.priceTypeGuid ? lower(contract.priceTypeGuid) : null
    },
    /** Цены товаров для клиента по выбранному (или основному) соглашению; товара без цены в ответе нет. */
    async get(clientGuid: string, itemGuids: string[], contractGuid?: string | null): Promise<Map<string, PriceT>> {
      const out = new Map<string, PriceT>()
      const priceType = this.priceTypeOf(clientGuid, contractGuid)
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
