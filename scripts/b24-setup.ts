// Idempotent setup of the box portal for the customer portal (docs/plan.md, stage 0).
// Reads the portal through the inbound webhook, plans the missing pieces (shared/b24Setup.ts)
// and prints them. Writes only with --apply: creating fields and smart processes in a live
// CRM is the owner's decision (docs/AGENT_RULES.md §5.8).
//
//   B24_WEBHOOK_URL=https://<portal>/rest/<id>/<code>/ pnpm b24:setup            # dry run
//   B24_WEBHOOK_URL=… pnpm b24:setup --apply                                     # write
//
// A new smart process gets its fields on the next run: the field entityId needs the type id
// the portal assigns on creation.
import { B24Hook } from '@bitrix24/b24jssdk'
import { COMPANY_GUID_FIELD, planSetup, type PortalState } from '../shared/b24Setup'

const url = process.env.B24_WEBHOOK_URL?.trim()
if (!url) {
  console.error('B24_WEBHOOK_URL is not set')
  process.exit(2)
}
const apply = process.argv.includes('--apply')
const b24 = B24Hook.fromWebhookUrl(url)

async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await b24.actions.v2.call.make<T>({ method, params })
  if (!response.isSuccess) throw new Error(`${method}: ${response.getErrorMessages().join('; ')}`)
  return response.getData()!.result
}

// List methods return 50 rows per page; `next` is the next offset. Reading only the first page
// would miss «Доступ в ЛК» on a portal with >50 smart processes and --apply would create a duplicate.
async function callAll<T>(method: string, params: Record<string, unknown>, pick: (result: unknown) => T[]): Promise<T[]> {
  const out: T[] = []
  for (let start: number | undefined = 0; start !== undefined;) {
    const response = await b24.actions.v2.call.make({ method, params: { ...params, start } })
    if (!response.isSuccess) throw new Error(`${method}: ${response.getErrorMessages().join('; ')}`)
    const data = response.getData() as { result: unknown, next?: number }
    out.push(...pick(data.result))
    start = typeof data.next === 'number' && data.next > start ? data.next : undefined
  }
  return out
}

async function readState(): Promise<PortalState> {
  const companyFields = await callAll('crm.company.userfield.list', { filter: { FIELD_NAME: COMPANY_GUID_FIELD } }, r => r as { FIELD_NAME: string }[])
  const types = await callAll('crm.type.list', {}, r => (r as { types: { id: number, entityTypeId: number, title: string }[] }).types)
  const smartProcesses = []
  for (const type of types) {
    const fields = await callAll('userfieldconfig.list', { moduleId: 'crm', filter: { entityId: `CRM_${type.id}` } }, r => (r as { fields: { fieldName: string }[] }).fields)
    smartProcesses.push({ id: Number(type.id), entityTypeId: Number(type.entityTypeId), title: type.title, fieldNames: fields.map(f => f.fieldName) })
  }
  const categories = await callAll('crm.category.list', { entityTypeId: 2 }, r => (r as { categories: { name: string }[] }).categories)
  return {
    companyFieldNames: companyFields.map(f => f.FIELD_NAME),
    smartProcesses,
    dealCategoryNames: categories.map(c => c.name),
  }
}

const { calls, pending } = planSetup(await readState())
if (calls.length === 0) console.log('Portal is already set up — nothing to do.')
for (const c of calls) {
  console.log(`${apply ? 'apply' : 'plan '} ${c.method} ${JSON.stringify(c.params)}`)
  if (apply) await call(c.method, c.params)
}
for (const p of pending) console.log(`pending: ${p}`)
if (!apply && calls.length > 0) console.log('Dry run. Re-run with --apply to write.')
