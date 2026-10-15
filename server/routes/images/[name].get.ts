// Картинки товаров с тома ЛК (§2.8 контракта 1С): имя — `<id>.<hash>`, версия в адресе, поэтому кэш — навсегда.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IMAGE_NAME_RE, sniffImage } from '../../utils/imageStore'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') ?? ''
  if (!IMAGE_NAME_RE.test(name)) throw createError({ statusCode: 404 })
  const bytes = await readFile(join(readServerEnv().dataDir, 'images', name)).catch(() => null)
  const type = bytes && sniffImage(bytes)
  if (!bytes || !type) throw createError({ statusCode: 404 })
  setResponseHeaders(event, {
    'Content-Type': type,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  })
  return bytes
})
