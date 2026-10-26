import { describe, expect, it } from 'vitest'
import { pruneTree, sectionPath, sectionTree } from '../app/utils/sectionTree'

const S = [
  { guid: 'B', parentGuid: null, name: 'Сантехника' },
  { guid: 'A', parentGuid: null, name: 'Крепёж' },
  { guid: 'A2', parentGuid: 'a', name: 'Шурупы' },
  { guid: 'A1', parentGuid: 'A', name: 'Болты' },
  { guid: 'X', parentGuid: 'нет-такого', name: 'Сирота' },
]

describe('sectionTree', () => {
  it('строит дерево по родителю без учёта регистра и сортирует по имени', () => {
    const t = sectionTree(S)
    expect(t.map(n => n.name)).toEqual(['Крепёж', 'Сантехника', 'Сирота'])
    expect(t[0]!.children.map(n => n.name)).toEqual(['Болты', 'Шурупы'])
  })
  it('раздел с неизвестным родителем — корневой, не теряется', () => {
    expect(sectionTree(S).some(n => n.guid === 'X')).toBe(true)
  })
  it('путь до выбранного раздела — от корня', () => {
    const t = sectionTree(S)
    expect(sectionPath(t, 'a2')).toEqual(['A', 'A2'])
    expect(sectionPath(t, '')).toEqual([])
    expect(sectionPath(t, 'нет')).toEqual([])
  })
  it('при «В наличии» — только ветки с товаром в наличии, родитель остаётся ради потомка', () => {
    const t = pruneTree(sectionTree(S), ['a2'])
    expect(t.map(n => n.guid)).toEqual(['A'])
    expect(t[0]!.children.map(n => n.guid)).toEqual(['A2'])
    expect(pruneTree(sectionTree(S), [])).toEqual([])
  })
})
