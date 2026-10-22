<!--
  Данные клиента из 1С (соглашение, адреса, зона) — до показа кабинета (решение владельца 2026-10-22).
  Грузятся при входе, если кэш старше срока; 1С не ответила — работаем по кэшу с датой, кэша нет —
  экран ошибки с «Повторить». Правила — `shared/clientData.ts`.
-->
<script setup lang="ts">
import { clientDataView, isClientRoute, type ClientDataResponse } from '../../shared/clientData'

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
watch(active, (on) => { if (on && !data.value && !pending.value) load() }, { immediate: true })
const view = computed(() => clientDataView(data.value))
</script>

<template>
  <template v-if="!active || failed">
    <slot />
  </template>
  <div v-else-if="pending || !data" class="p-6">
    <BuildLoader title="Загружаем ваши данные из учётной системы…" />
  </div>
  <div v-else-if="view.block" class="mx-auto max-w-xl p-6 flex flex-col gap-4">
    <B24Alert color="air-primary-alert" :title="view.message" />
    <B24Button v-if="view.retry" color="air-primary" label="Повторить" class="self-start" @click="load(true)" />
  </div>
  <template v-else>
    <B24Alert v-if="view.message" color="air-primary-warning" :title="view.message" class="rounded-none" />
    <slot />
  </template>
</template>
