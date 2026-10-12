/**
 * Лимит частоты на процесс: не больше `max` событий за окно на ключ. Резервирует место сразу —
 * параллельные запросы не проскакивают между проверкой и записью; при ошибке место можно вернуть.
 * Один экземпляр ЛК (docs/DEPLOY.md, «Ограничения прототипа») — память процесса достаточна.
 */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now, keysMax = 50_000) {
  const hits = new Map<string, number[]>()
  return {
    /** true — разрешено и учтено; false — лимит исчерпан. */
    take(key: string): boolean {
      const t = now()
      const recent = (hits.get(key) ?? []).filter(x => x > t - windowMs)
      if (recent.length >= max) {
        hits.set(key, recent)
        return false
      }
      recent.push(t)
      hits.delete(key)
      hits.set(key, recent)
      // Вытесняем самые давние ключи, а не сбрасываем всё: сброс открыл бы лимит всем разом.
      while (hits.size > keysMax) hits.delete(hits.keys().next().value!)
      return true
    },
    /** Вернуть последнее учтённое место (действие не состоялось). */
    release(key: string) {
      hits.get(key)?.pop()
    },
  }
}
