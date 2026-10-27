<!--
  Хлебные крошки разделов без слова «Каталог»: каждое звено — выпадающее меню с соседними разделами
  того же уровня (решение владельца 2026-10-27, слот Breadcrumb из документации b24ui).
-->
<script setup lang="ts">
import type { BreadcrumbItem, DropdownMenuItem } from '@bitrix24/b24ui-nuxt'
import type { RouteLocationRaw } from 'vue-router'
import ChevronDownSIcon from '@bitrix24/b24icons-vue/outline/ChevronDownSIcon'

const props = defineProps<{
  sections: { guid: string, parentGuid: string | null, name: string }[]
  guid: string
  link: (guid: string) => RouteLocationRaw
  visible?: (guid: string) => boolean
}>()

const levels = computed(() => crumbLevels(props.sections, props.guid, props.visible))
const items = computed<BreadcrumbItem[]>(() => levels.value.map(l => ({ label: l.name, slot: 'level' as const, value: l.guid })))
function menu(guid: string): DropdownMenuItem[] {
  const l = levels.value.find(x => x.guid === guid)
  if (!l) return []
  return l.siblings.map(s => ({ label: s.name, to: props.link(s.guid), active: s.guid.toLowerCase() === l.guid.toLowerCase() }))
}
</script>

<template>
  <B24Breadcrumb v-if="items.length" :items="items" :b24ui="{ list: 'flex-wrap' }">
    <template #level="{ item }: { item: BreadcrumbItem & { value?: string } }">
      <B24DropdownMenu :items="menu(item.value ?? '')" :content="{ align: 'start' }" :b24ui="{ content: 'max-h-80' }">
        <B24Button
          color="air-tertiary-no-accent"
          size="sm"
          :label="item.label"
          :trailing-icon="ChevronDownSIcon"
          class="whitespace-normal text-start"
        />
      </B24DropdownMenu>
    </template>
  </B24Breadcrumb>
</template>
