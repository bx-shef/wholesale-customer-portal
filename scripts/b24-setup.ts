// Idempotent setup of the box portal for the customer portal (docs/plan.md, stage 0) through the
// inbound webhook — a developer tool for test stands. In production the installed local app runs
// the same plan itself on install (server/utils/b24AppAuth.ts), and `make b24-setup` re-runs it.
// Writes only with --apply: creating fields and smart processes in a live CRM is the owner's call.
//
//   B24_WEBHOOK_URL=https://<portal>/rest/<id>/<code>/ pnpm b24:setup            # dry run
//   B24_WEBHOOK_URL=… pnpm b24:setup --apply                                     # write
import { B24Hook } from '@bitrix24/b24jssdk'
import { runSetup } from '../shared/b24SetupRun'

const url = process.env.B24_WEBHOOK_URL?.trim()
if (!url) {
  console.error('B24_WEBHOOK_URL is not set')
  process.exit(2)
}
const apply = process.argv.includes('--apply')
const b24 = B24Hook.fromWebhookUrl(url)

const report = await runSetup(async (method, params) => {
  const response = await b24.actions.v2.call.make({ method, params })
  if (!response.isSuccess) throw new Error(`${method}: ${response.getErrorMessages().join('; ')}`)
  return response.getData()!.result
}, apply)
for (const line of report.lines) console.log(line)
for (const p of report.pending) console.log(`pending: ${p}`)
console.log(report.done ? 'Portal is already set up — nothing to do.' : apply ? 'Not finished — run again.' : 'Dry run. Re-run with --apply to write.')
