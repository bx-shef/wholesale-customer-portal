// При старте — кривые значения окружения в лог (без самих значений).
export default defineNitroPlugin(() => {
  for (const w of envWarnings(process.env)) console.warn(`[env] ${w}`)
})
