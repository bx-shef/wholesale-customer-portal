/**
 * Картинки товаров на сервере ЛК (docs/onec-contract.md §2.8): у 1С нет публичных адресов,
 * файл приходит base64 методом `GET /image/{id}`, ЛК кладёт его на том `/data` и раздаёт сам
 * по адресу `/images/<id>.<hash>`. Версия в имени — поэтому кэшировать можно навсегда, а замена
 * файла в 1С (новый hash) даёт новый адрес.
 *
 * Чистая часть: адреса, проверка содержимого. Файлы — через внедряемую файловую систему.
 */
import type { ImageFileT, ImageRefT } from '../../shared/onec/schemas'
import { IMAGE_MAX_BYTES } from '../../shared/onec/schemas'

export const IMAGE_NAME_RE = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9]{1,64})$/

export const imageName = (ref: ImageRefT) => `${ref.id}.${ref.hash}`
export const imageUrl = (ref: ImageRefT) => `/images/${imageName(ref)}`

/** Обратно из адреса каталога — для докачки; чужие строки (старые адреса) — `null`. */
export function refFromUrl(url: string): ImageRefT | null {
  const m = /^\/images\/(.+)$/.exec(url)
  const n = m && IMAGE_NAME_RE.exec(m[1]!)
  return n ? { id: n[1]!, hash: n[2]! } : null
}

/** Тип по первым байтам: верить `contentType` из 1С на слово нельзя (SVG со скриптом — тоже «картинка»). */
export function sniffImage(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].every((b, i) => bytes[i] === b)) return 'image/png'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export type DecodeResult = { ok: true, bytes: Buffer } | { ok: false, reason: string }

/** Файл из ответа 1С → байты: размер, формат и соответствие заявленному типу. */
export function decodeImage(file: ImageFileT, expected: ImageRefT): DecodeResult {
  if (file.id !== expected.id) return { ok: false, reason: 'id в ответе не тот' }
  const bytes = Buffer.from(file.data, 'base64')
  if (bytes.length === 0) return { ok: false, reason: 'пустой файл' }
  if (bytes.length > IMAGE_MAX_BYTES) return { ok: false, reason: 'больше 5 МБ' }
  const real = sniffImage(bytes)
  if (!real) return { ok: false, reason: 'не JPEG, PNG или WebP' }
  if (real !== file.contentType) return { ok: false, reason: `contentType ${file.contentType}, а файл — ${real}` }
  return { ok: true, bytes }
}

export interface ImageFs {
  exists: (name: string) => Promise<boolean>
  write: (name: string, bytes: Buffer) => Promise<void>
}

/** Сколько картинок докачивать за прогон: остальные — в следующий час, каталог не ждёт. */
export const IMAGES_PER_RUN = 300

/**
 * Докачать картинки, которых ещё нет. Файл кладётся под тем hash, что пришёл в ответе: если в
 * 1С файл успели заменить, адрес каталога станет верным на следующем прогоне каталога.
 */
export async function fetchMissingImages(
  refs: ImageRefT[],
  deps: { fs: ImageFs, load: (id: string) => Promise<ImageFileT>, limit?: number },
): Promise<{ saved: number, failed: { id: string, reason: string }[], left: number }> {
  const todo: ImageRefT[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const name = imageName(ref)
    if (seen.has(name)) continue
    seen.add(name)
    if (!(await deps.fs.exists(name))) todo.push(ref)
  }
  const limit = deps.limit ?? IMAGES_PER_RUN
  let saved = 0
  const failed: { id: string, reason: string }[] = []
  for (const ref of todo.slice(0, limit)) {
    try {
      const file = await deps.load(ref.id)
      const decoded = decodeImage(file, ref)
      if (!decoded.ok) {
        failed.push({ id: ref.id, reason: decoded.reason })
        continue
      }
      await deps.fs.write(imageName({ id: ref.id, hash: file.hash }), decoded.bytes)
      saved++
    }
    catch (e) {
      failed.push({ id: ref.id, reason: (e as Error).message })
    }
  }
  return { saved, failed, left: Math.max(0, todo.length - limit) }
}
