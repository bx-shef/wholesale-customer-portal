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
