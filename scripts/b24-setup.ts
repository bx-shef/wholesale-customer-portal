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

async function readState(): Promise<PortalState> {
  const companyFields = await call<{ FIELD_NAME: string }[]>('crm.company.userfield.list', { filter: { FIELD_NAME: COMPANY_GUID_FIELD } })
  const { types } = await call<{ types: { id: number, entityTypeId: number, title: string }[] }>('crm.type.list', {})
  const smartProcesses = []
  for (const type of types) {
    const { fields } = await call<{ fields: { fieldName: string }[] }>('userfieldconfig.list', { moduleId: 'crm', filter: { entityId: `CRM_${type.id}` } })
    smartProcesses.push({ id: Number(type.id), entityTypeId: Number(type.entityTypeId), title: type.title, fieldNames: fields.map(f => f.fieldName) })
  }
  const { categories } = await call<{ categories: { name: string }[] }>('crm.category.list', { entityTypeId: 2 })
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
