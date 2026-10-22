/**
 * Клиенты 1С в базе ЛК: договор и адреса доставки. Пишет синхронизация клиентов (тот же поток,
 * что заводит компании в Б24), читают корзина и заявка — без похода в 1С на каждый экран.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { ClientT, ContractT } from '../../shared/onec/schemas'

export interface DeliveryAddress { guid: string, city: string, address: string }
export interface StoredClient {
  guid: string
  name: string
  contractGuid: string | null
  contract: ContractT | null
  /** Все действующие соглашения; первое — по умолчанию (#46). */
  contracts: ContractT[]
  addresses: DeliveryAddress[]
  /** Бизнес-регион 1С: по нему — график доставки. */
  regionGuid: string | null
  regionName: string | null
  /** Сегмент запрета отгрузки: заявку принимаем, отгрузку решает 1С. */
  shipmentBlocked: boolean
  deleted: boolean
  /** Когда данные загружены из 1С; `null` — заведён списком клиентов до поклиентской загрузки. */
  loadedAt: string | null
}

/** Соглашения клиента: основное первым, без повторов; у источника без списка — только основное. */
export function contractsOf(c: Pick<ClientT, 'contract' | 'contracts'>): ContractT[] {
  const all = [...(c.contract ? [c.contract] : []), ...(c.contracts ?? [])].map(x => ({ ...x, guid: x.guid.toLowerCase() }))
  return [...new Map(all.map(x => [x.guid, x])).values()]
}

/** Соглашение для расчёта: выбранное клиентом, если оно из его действующих, иначе основное (#46). */
export function chooseContract(client: Pick<StoredClient, 'contract' | 'contracts'>, wanted?: string | null): ContractT | null {
  const w = wanted?.toLowerCase()
  return (w && client.contracts.find(c => c.guid === w)) || client.contract
}

export function createClientStore(db: DatabaseSync) {
  const upsert = db.prepare(`INSERT INTO onec_client (guid, name, contract_guid, contract, contracts, addresses, region_guid, region_name, shipment_blocked, deleted, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guid) DO UPDATE SET name = excluded.name, contract_guid = excluded.contract_guid, contract = excluded.contract, contracts = excluded.contracts,
      addresses = excluded.addresses, region_guid = excluded.region_guid, region_name = excluded.region_name,
      shipment_blocked = excluded.shipment_blocked, deleted = excluded.deleted, changed_at = excluded.changed_at`)
  const get = db.prepare('SELECT guid, name, contract_guid, contract, contracts, addresses, region_guid, region_name, shipment_blocked, deleted, loaded_at FROM onec_client WHERE guid = ?')
  const markLoaded = db.prepare('UPDATE onec_client SET loaded_at = ? WHERE guid = ?')
  const markSeen = db.prepare('UPDATE onec_client SET seen_at = ? WHERE guid = ?')
  const due = db.prepare('SELECT guid FROM onec_client WHERE seen_at >= ? AND (loaded_at IS NULL OR loaded_at < ?) ORDER BY loaded_at, guid LIMIT ?')
  return {
    /** `loadedAt` — загружено поклиентски из 1С в этот момент. */
    save(clients: ClientT[], loadedAt?: string) {
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const c of clients) {
        const addresses = c.deliveryAddresses.map(a => ({ guid: a.guid.toLowerCase(), city: a.city, address: a.address }))
        upsert.run(c.guid.toLowerCase(), c.name, c.contract?.guid.toLowerCase() ?? null, c.contract ? JSON.stringify(c.contract) : null, JSON.stringify(contractsOf(c)), JSON.stringify(addresses),
          c.region?.guid.toLowerCase() ?? null, c.region?.name ?? null, c.shipmentBlocked ? 1 : 0, c.deleted ? 1 : 0, c.changedAt)
        if (loadedAt) markLoaded.run(loadedAt, c.guid.toLowerCase())
        }
        db.exec('COMMIT')
      }
      catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    get(guid: string): StoredClient | null {
      const row = get.get(guid.toLowerCase()) as { guid: string, name: string, contract_guid: string | null, contract: string | null, contracts: string | null, addresses: string, region_guid: string | null, region_name: string | null, shipment_blocked: number, deleted: number, loaded_at: string | null } | undefined
      if (!row) return null
      return {
        guid: row.guid, name: row.name, contractGuid: row.contract_guid, contract: row.contract ? JSON.parse(row.contract) as ContractT : null,
        contracts: row.contracts ? JSON.parse(row.contracts) as ContractT[] : row.contract ? [JSON.parse(row.contract) as ContractT] : [],
        addresses: JSON.parse(row.addresses), regionGuid: row.region_guid, regionName: row.region_name, shipmentBlocked: row.shipment_blocked === 1, deleted: row.deleted === 1, loadedAt: row.loaded_at,
      }
    },
    /** Клиент заходил в ЛК: по этой отметке расписание обновляет только живых клиентов. */
    seen(guid: string, at: string) {
      markSeen.run(at, guid.toLowerCase())
    },
    /** GUID клиентов, заходивших после `seenSince`, чьи данные старше `loadedBefore`. */
    due(seenSince: string, loadedBefore: string, limit: number): string[] {
      return (due.all(seenSince, loadedBefore, limit) as { guid: string }[]).map(r => r.guid)
    },
  }
}

export type ClientStore = ReturnType<typeof createClientStore>
