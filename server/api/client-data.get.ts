import { contractLabel } from '../../shared/contractChoice'
import { chooseContract } from '../utils/clients'

// Данные клиента из 1С (соглашение, адреса, зона): при входе — из кэша, если он свежий, иначе из 1С.
// `?refresh=1` — кнопка «Повторить». GUID — только по компании из сессии.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  if (ctx.pricing.status !== 'ok') return { status: ctx.pricing.status === 'unavailable' ? 'crm_unavailable' as const : 'missing' as const, loadedAt: null, hasContract: false, contracts: [], selected: null }
  const force = getQuery(event).refresh === '1'
  if (force) takeLimit(limits.quote, ctx.session.contactId)
  const r = await useClientLoader().ensure(ctx.pricing.clientGuid, { force })
  const usable = r.client && !r.client.deleted ? r.client : null
  // Соглашения для выбора в корзине (#46): только подпись и GUID, без лимитов и долгов.
  const contracts = (usable?.contracts ?? []).map(c => ({ guid: c.guid, label: contractLabel(c) }))
  const selected = usable ? chooseContract(usable, ctx.pricing.contractGuid)?.guid ?? null : null
  return { status: r.status, loadedAt: r.loadedAt, hasContract: Boolean(selected), contracts, selected }
})
