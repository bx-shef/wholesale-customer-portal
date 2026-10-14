/**
 * Журнал диалогов ИИ-помощника (docs/spec.md §7): вопрос, ответ, показанные товары и оценка
 * клиента. Нужен, чтобы видеть, где помощник ошибается, — разбор через `ai_dialogs` в /mcp/admin.
 * Хранится 90 дней (maintenance:prune). Данные клиента — только его компании: оценить можно
 * только свою запись.
 */
import type { DatabaseSync } from 'node:sqlite'

export type AiRating = 1 | -1 | 0

export interface AiDialogRow {
  id: number
  createdAt: string
  companyId: number
  contactId: number
  question: string
  answer: string | null
  products: string[]
  topic: string | null
  status: 'started' | 'done' | 'error'
  rating: number | null
}

export function createAiJournal(db: DatabaseSync, now: () => Date = () => new Date()) {
  const insert = db.prepare(`INSERT INTO ai_dialog (created_at, company_id, contact_id, question, topic) VALUES (?, ?, ?, ?, ?)`)
  const finish = db.prepare(`UPDATE ai_dialog SET answer = ?, products = ?, status = ? WHERE id = ?`)
  const rate = db.prepare(`UPDATE ai_dialog SET rating = ?, rated_at = ? WHERE id = ? AND contact_id = ? AND company_id = ?`)
  return {
    start(e: { companyId: number, contactId: number, question: string, topic?: string | null }): number {
      return Number(insert.run(now().toISOString(), e.companyId, e.contactId, e.question.slice(0, 2000), e.topic ?? null).lastInsertRowid)
    },
    finish(id: number, e: { answer: string, products: string[], ok: boolean }) {
      finish.run(e.answer.slice(0, 8000), JSON.stringify(e.products.slice(0, 20)), e.ok ? 'done' : 'error', id)
    },
    /** Оценка — только своей записи; чужой id молча не меняет ничего. 0 — снять оценку. */
    rate(id: number, who: { companyId: number, contactId: number }, rating: AiRating): boolean {
      return Number(rate.run(rating === 0 ? null : rating, rating === 0 ? null : now().toISOString(), id, who.contactId, who.companyId).changes) > 0
    },
    list(f: { rating?: 1 | -1, limit?: number } = {}): AiDialogRow[] {
      const where = f.rating ? 'WHERE rating = ?' : ''
      const args: (number)[] = f.rating ? [f.rating] : []
      const rows = db.prepare(`SELECT id, created_at AS createdAt, company_id AS companyId, contact_id AS contactId, question, answer,
        products, topic, status, rating FROM ai_dialog ${where} ORDER BY id DESC LIMIT ?`)
        .all(...args, Math.min(Math.max(f.limit ?? 50, 1), 200)) as unknown as (Omit<AiDialogRow, 'products'> & { products: string })[]
      return rows.map(r => ({ ...r, products: JSON.parse(r.products) as string[] }))
    },
  }
}

export type AiJournal = ReturnType<typeof createAiJournal>

let journal: AiJournal | undefined
export function useAiJournal(): AiJournal {
  journal ??= createAiJournal(useDb())
  return journal
}
