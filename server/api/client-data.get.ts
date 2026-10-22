// Данные клиента из 1С (соглашение, адреса, зона): при входе — из кэша, если он свежий, иначе из 1С.
// `?refresh=1` — кнопка «Повторить». GUID — только по компании из сессии.
export default defineEventHandler(async (event) => {
  const ctx = await orderContext(event)
  if (ctx.pricing.status !== 'ok') return { status: ctx.pricing.status === 'unavailable' ? 'crm_unavailable' as const : 'missing' as const, loadedAt: null, hasContract: false }
  const force = getQuery(event).refresh === '1'
  if (force) takeLimit(limits.quote, ctx.session.contactId)
  const r = await useClientLoader().ensure(ctx.pricing.clientGuid, { force })
  return { status: r.status, loadedAt: r.loadedAt, hasContract: Boolean(r.client?.contractGuid && !r.client.deleted) }
})
