import { describe, expect, it } from 'vitest'
import { createStandJobs } from '../server/utils/standJobs'

describe('createStandJobs', () => {
  it('running → done, ошибка → failed, старые результаты вычищаются', async () => {
    let t = 0
    const jobs = createStandJobs<number>({ ttlMs: 100, now: () => t })
    let finish!: (v: number) => void
    const id = jobs.start(() => new Promise<number>((r) => { finish = r }))
    expect(jobs.get(id)).toMatchObject({ status: 'running' })
    finish(42)
    await Promise.resolve(); await Promise.resolve()
    expect(jobs.get(id)).toMatchObject({ status: 'done', result: 42 })
    const bad = jobs.start(async () => { throw new Error('1С молчит') })
    await Promise.resolve(); await Promise.resolve()
    expect(jobs.get(bad)).toMatchObject({ status: 'failed', error: '1С молчит' })
    t = 1000
    expect(jobs.get(id)).toBeUndefined()
  })
})
