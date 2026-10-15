import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { buildOnecOpenApi } from '../shared/onec/openapi'

describe('contracts/onec.openapi.yaml', () => {
  it('совпадает со схемами shared/onec — иначе pnpm onec:openapi', () => {
    const committed = parse(readFileSync(join(import.meta.dirname, '../contracts/onec.openapi.yaml'), 'utf8'))
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOnecOpenApi())))
  })

  it('описывает все семь методов контракта', () => {
    const paths = buildOnecOpenApi().paths
    expect(Object.keys(paths).sort()).toEqual(['/catalog', '/clients', '/image/{id}', '/order', '/orders/status', '/prices', '/stock'])
  })
})
