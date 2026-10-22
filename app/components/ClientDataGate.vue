<!--
  Данные клиента из 1С (соглашение, адреса, зона) — до показа кабинета (решение владельца 2026-10-22).
  Грузятся при входе, если кэш старше срока; 1С не ответила — работаем по кэшу с датой, кэша нет —
  экран ошибки с «Повторить». Правила — `shared/clientData.ts`.
-->
<script setup lang="ts">
import { clientDataView, isClientRoute, type ClientDataResponse } from '~~/shared/clientData'

const route = useRoute()
const data = useState<ClientDataResponse | null>('client-data', () => null)
const pending = ref(false)
const failed = ref(false)

async function load(refresh = false) {
  pending.value = true
  failed.value = false
  try {
    data.value = await $fetch<ClientDataResponse>('/api/client-data', { query: refresh ? { refresh: '1' } : {} })
  }
  catch {
    // Без сети или без ответа сервера — не держим кабинет закрытым: каталог мог сохраниться.
    failed.value = true
  }
  finally {
    pending.value = false
  }
}

const active = computed(() => isClientRoute(route.path))
// Только в браузере: на сервере нет куки сессии в $fetch, и разметка разошлась бы с клиентом.
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
  if (active.value) load()
})
// Сбой сети не держит кабинет открытым без данных навсегда: на следующей странице пробуем снова.
watch(() => route.path, () => {
  if (mounted.value && active.value && (!data.value || failed.value) && !pending.value) load()
})
const view = computed(() => clientDataView(data.value))
</script>

<template>
  <!-- Страница отрисовывается всегда (на сервере — с её переходами, например на /login без сессии);
       загрузка и ошибка ложатся поверх только в браузере — разметка сервера и браузера совпадает. -->
  <div v-if="mounted && active && !failed && view.block" class="mx-auto max-w-xl p-6 flex flex-col gap-4">
    <B24Alert color="air-primary-alert" :title="view.message" />
    <B24Button v-if="view.retry" color="air-primary" label="Повторить" class="self-start" @click="load(true)" />
  </div>
  <template v-else>
    <B24Alert v-if="mounted && active && !failed && view.message" color="air-primary-warning" :title="view.message" class="rounded-none" />
    <slot />
    <div v-if="mounted && active && !failed && (pending || !data)" class="fixed inset-0 z-50 bg-white/95 dark:bg-gray-950/95 p-6 overflow-auto">
      <BuildLoader title="Загружаем ваши данные из учётной системы…" />
    </div>
  </template>
</template>
