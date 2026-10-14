import { describe, expect, it, vi } from 'vitest'
import type { CatalogItemView } from '../shared/catalogView'
import { AI_TOOL_ROUNDS_MAX, chatRequestSchema, deepseekLlm, runChat, type ChatTools, type Llm, type LlmMessage } from '../server/utils/aiChat'

const item = (guid: string, value = 10): CatalogItemView => ({ guid, sku: 'A', name: `Товар ${guid}`, sectionGuid: 's', brand: 'B', unit: 'шт', packQty: 1, minQty: 1, available: 5, image: null, price: { value, currency: 'BYN', vatRate: 20 } })
const call = (name: string, args: unknown, id = name): LlmMessage => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const text = (content: string): LlmMessage => ({ role: 'assistant', content })
const req = chatRequestSchema.parse({ messages: [{ role: 'user', content: 'шпатлёвка' }] })

function tools(): ChatTools & { search: ReturnType<typeof vi.fn> } {
  return { search: vi.fn(async () => [item('g1'), item('g2')]), details: async g => (g === 'g1' ? { item: { ...item('g1'), description: 'd' }, analogs: [item('g3')] } : null) } as never
}

function script(...answers: LlmMessage[]) {
  const llm = vi.fn<Llm>(async () => answers.shift() ?? text('конец'))
  return llm
}

describe('ИИ-помощник', () => {
  it('карточки — только из ответов инструментов, цена из каталога', async () => {
    const llm = script(call('search_products', { query: 'шпатлёвка' }), call('show_products', { guids: ['g1', 'выдуманный'] }), text('Вот'))
    const r = await runChat(req, llm, tools())
    expect(r).toEqual({ reply: 'Вот', items: [item('g1')] })
  })

  it('аналоги из карточки тоже можно показать; неизвестный товар — ошибка модели, не сбой', async () => {
    const llm = script(call('get_product', { guid: 'g1' }), call('get_product', { guid: 'нет' }, 'x'), call('show_products', { guids: ['g3'] }), text('ok'))
    expect((await runChat(req, llm, tools())).items.map(i => i.guid)).toEqual(['g3'])
    const toolMsgs = llm.mock.calls.at(-1)![0].filter(m => m.role === 'tool')
    expect(toolMsgs[1]!.content).toContain('не найден')
  })

  it('модель зациклилась — последний раунд без инструментов', async () => {
    const llm = vi.fn<Llm>(async (_m, t) => (t.length ? call('search_products', { query: 'x' }) : text('итог')))
    expect((await runChat(req, llm, tools())).reply).toBe('итог')
    expect(llm).toHaveBeenCalledTimes(AI_TOOL_ROUNDS_MAX + 1)
  })

  it('в модель уходит системный промпт и переписка, без данных клиента', async () => {
    const llm = script(text('ок'))
    await runChat(req, llm, tools())
    const sent = llm.mock.calls[0]![0]
    expect(sent[0]!.role).toBe('system')
    expect(sent.slice(1)).toEqual([{ role: 'user', content: 'шпатлёвка' }])
  })

  it('запрос: роли только user/assistant, длина ограничена', () => {
    expect(chatRequestSchema.safeParse({ messages: [{ role: 'system', content: 'x' }] }).success).toBe(false)
    expect(chatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'x'.repeat(1001) }] }).success).toBe(false)
  })

  it('DeepSeek: ключ в заголовке, сбой HTTP — исключение без ключа в тексте', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: text('привет') }] })))
    expect(await deepseekLlm('sk-secret', 'deepseek-chat', f as never)([], [])).toEqual(text('привет'))
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: { Authorization: 'Bearer sk-secret' } })
    const bad = deepseekLlm('sk-secret', 'm', (async () => new Response('', { status: 401 })) as never)
    await expect(bad([], [])).rejects.toThrow(/^DeepSeek HTTP 401$/)
  })
})
