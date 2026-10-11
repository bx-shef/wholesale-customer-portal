// Writes contracts/onec.openapi.yaml from the zod contract (shared/onec/openapi.ts).
// tests/onecOpenapi.test.ts fails when the committed file is stale.
import { mkdirSync, writeFileSync } from 'node:fs'
import { stringify } from 'yaml'
import { buildOnecOpenApi } from '../shared/onec/openapi'

mkdirSync('contracts', { recursive: true })
writeFileSync('contracts/onec.openapi.yaml', stringify(buildOnecOpenApi(), { lineWidth: 0, aliasDuplicateObjects: false }))
console.log('contracts/onec.openapi.yaml written')
