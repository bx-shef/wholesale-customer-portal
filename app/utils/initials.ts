// Правовые формы не дают букв аватарке: «ООО «Ромашка»» → «Р», а не «ОР».
const LEGAL = new Set(['ооо', 'оао', 'зао', 'одо', 'чуп', 'уп', 'ип', 'чп', 'ао', 'пао', 'тоо'])

/** Две буквы для аватарки компании: первые буквы первых двух слов без правовой формы, заглавные. */
export function initials(title: string): string {
  const words = title.replace(/[«»"'()]/g, ' ').split(/\s+/).filter(w => /\p{L}/u.test(w) && !LEGAL.has(w.toLowerCase()))
  const letters = words.slice(0, 2).map(w => w.match(/\p{L}/u)![0].toUpperCase()).join('')
  return letters || '?'
}
