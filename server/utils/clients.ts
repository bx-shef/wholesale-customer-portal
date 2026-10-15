/**
 * Клиенты 1С в базе ЛК: договор и адреса доставки. Пишет синхронизация клиентов (тот же поток,
 * что заводит компании в Б24), читают корзина и заявка — без похода в 1С на каждый экран.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { ClientT, ContractT } from '../../shared/onec/schemas'

export interface DeliveryAddress { guid: string, city: string, address: string }
export interface StoredClient { guid: string, name: string, contractGuid: string | null, contract: ContractT | null, addresses: DeliveryAddress[], deleted: boolean }

export function createClientStore(db: DatabaseSync) {
  const upsert = db.prepare(`INSERT INTO onec_client (guid, name, contract_guid, contract, addresses, deleted, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guid) DO UPDATE SET name = excluded.name, contract_guid = excluded.contract_guid, contract = excluded.contract,
      addresses = excluded.addresses, deleted = excluded.deleted, changed_at = excluded.changed_at`)
  const get = db.prepare('SELECT guid, name, contract_guid, contract, addresses, deleted FROM onec_client WHERE guid = ?')
  return {
    save(clients: ClientT[]) {
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const c of clients) {
        const addresses = c.deliveryAddresses.map(a => ({ guid: a.guid.toLowerCase(), city: a.city, address: a.address }))
        upsert.run(c.guid.toLowerCase(), c.name, c.contract?.guid.toLowerCase() ?? null, c.contract ? JSON.stringify(c.contract) : null, JSON.stringify(addresses), c.deleted ? 1 : 0, c.changedAt)
        }
        db.exec('COMMIT')
      }
      catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    get(guid: string): StoredClient | null {
      const row = get.get(guid.toLowerCase()) as { guid: string, name: string, contract_guid: string | null, contract: string | null, addresses: string, deleted: number } | undefined
      if (!row) return null
      return { guid: row.guid, name: row.name, contractGuid: row.contract_guid, contract: row.contract ? JSON.parse(row.contract) as ContractT : null, addresses: JSON.parse(row.addresses), deleted: row.deleted === 1 }
    },
  }
}

export type ClientStore = ReturnType<typeof createClientStore>
