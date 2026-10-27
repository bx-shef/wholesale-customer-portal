/** Узел дерева разделов каталога для бокового меню. */
export interface SectionNode {
  guid: string
  name: string
  children: SectionNode[]
}

/**
 * Плоский список разделов 1С → дерево по `parentGuid`. Раздел с неизвестным родителем
 * становится корневым: иначе он пропал бы из меню вместе с товарами.
 */
export function sectionTree(sections: { guid: string, parentGuid: string | null, name: string }[]): SectionNode[] {
  const nodes = new Map<string, SectionNode>()
  for (const s of sections) nodes.set(s.guid.toLowerCase(), { guid: s.guid, name: s.name, children: [] })
  const roots: SectionNode[] = []
  for (const s of sections) {
    const node = nodes.get(s.guid.toLowerCase())!
    const parent = s.parentGuid ? nodes.get(s.parentGuid.toLowerCase()) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  const byName = (a: SectionNode, b: SectionNode) => a.name.localeCompare(b.name, 'ru')
  const sort = (list: SectionNode[]) => {
    list.sort(byName)
    for (const n of list) sort(n.children)
  }
  sort(roots)
  return roots
}

/**
 * Оставить только ветки, где есть хоть один раздел из `keep` (раздел или его потомок).
 * Так при «В наличии» папка без товаров в наличии не показывается.
 */
export function pruneTree(roots: SectionNode[], keep: Iterable<string>): SectionNode[] {
  const want = new Set([...keep].map(g => g.toLowerCase()))
  const walk = (list: SectionNode[]): SectionNode[] => list.flatMap((n) => {
    const children = walk(n.children)
    return children.length || want.has(n.guid.toLowerCase()) ? [{ ...n, children }] : []
  })
  return walk(roots)
}

/** Цепочка разделов от корня до выбранного — их держим раскрытыми в меню. */
export function sectionPath(roots: SectionNode[], guid: string): string[] {
  const want = guid.toLowerCase()
  const walk = (list: SectionNode[], path: string[]): string[] | null => {
    for (const n of list) {
      const next = [...path, n.guid]
      if (n.guid.toLowerCase() === want) return next
      const found = walk(n.children, next)
      if (found) return found
    }
    return null
  }
  return want ? walk(roots, []) ?? [] : []
}

/**
 * Хлебные крошки товара: разделы от корня до раздела товара по `parentGuid`.
 * Защита от петли в данных 1С — не больше 20 шагов; неизвестный раздел — пустой путь.
 */
export function sectionTrail(sections: { guid: string, parentGuid: string | null, name: string }[], guid: string): { guid: string, name: string }[] {
  const byGuid = new Map(sections.map(s => [s.guid.toLowerCase(), s]))
  const trail: { guid: string, name: string }[] = []
  let cur = byGuid.get(guid.toLowerCase())
  while (cur && trail.length < 20) {
    trail.unshift({ guid: cur.guid, name: cur.name })
    cur = cur.parentGuid ? byGuid.get(cur.parentGuid.toLowerCase()) : undefined
    if (cur && trail.some(t => t.guid === cur!.guid)) break
  }
  return trail
}
