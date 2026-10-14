// Оценка ответа помощника 👍/👎 (0 — снять). Только своей записи журнала: id чужого диалога не меняет ничего.
import { z } from 'zod'

const schema = z.object({ dialogId: z.number().int().positive(), rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]) })

export default defineEventHandler(async (event) => {
  const session = await resolveClientSession(event)
  if (!session) throw createError({ statusCode: 401 })
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400 })
  const ok = useAiJournal().rate(parsed.data.dialogId, session, parsed.data.rating)
  return { ok }
})
