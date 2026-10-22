<!--
  Главная страница локального приложения в коробке (пункт меню слева, «Перейти к приложению»).
  Вкладка «Личный кабинет» живёт отдельно — в карточке компании (placement CRM_COMPANY_DETAIL_TAB,
  /b24/company-tab). Здесь — состояние подключения, как работать с ЛК и «Ближайшие доставки»:
  рейсы из заданий на перевозку 1С, только для информирования (правятся в 1С).
-->
<script setup lang="ts">
import type { B24Frame } from '@bitrix24/b24jssdk'

useHead({ title: 'Личный кабинет' })

interface Trip {
  guid: string
  number: string
  status: 'forming' | 'loading' | 'sent' | 'closed'
  plannedStart: string
  actualStart: string | null
  vehicle: string
  regions: string[]
  orders: { orderGuid: string, number: string, clientName: string | null }[]
}

const tabs = [{ label: 'Подключение', slot: 'about' as const, value: 'about' }, { label: 'Ближайшие доставки', slot: 'trips' as const, value: 'trips' }]
const TRIP_STATUS: Record<Trip['status'], { label: string, color: 'air-secondary' | 'air-primary' | 'air-primary-warning' | 'air-primary-success' }> = {
  forming: { label: 'Формируется', color: 'air-secondary' },
  loading: { label: 'К погрузке', color: 'air-primary-warning' },
  sent: { label: 'В пути', color: 'air-primary' },
  closed: { label: 'Закрыт', color: 'air-primary-success' },
}
let frame: B24Frame | null = null
const trips = ref<Trip[] | null>(null)
const tripsError = ref('')
const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk', weekday: 'short', day: 'numeric', month: 'long' })
const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Minsk', hour: '2-digit', minute: '2-digit' })
/** Рейсы по дням: сотруднику проще читать «сегодня, завтра…», чем общий список. */
const byDay = computed(() => {
  const out: { day: string, trips: Trip[] }[] = []
  for (const t of trips.value ?? []) {
    const d = day(t.plannedStart)
    if (out.at(-1)?.day !== d) out.push({ day: d, trips: [] })
    out.at(-1)!.trips.push(t)
  }
  return out
})

async function loadTrips() {
  tripsError.value = ''
  const auth = frame?.auth.getAuthData()
  if (!auth) {
    tripsError.value = 'Откройте страницу из портала Битрикс24'
    return
  }
  try {
    trips.value = (await $fetch<{ trips: Trip[] }>('/api/b24/deliveries', { method: 'POST', body: { domain: auth.domain, authId: auth.access_token } })).trips
  }
  catch (e) {
    tripsError.value = (e as { data?: { message?: string } }).data?.message || 'Не удалось загрузить рейсы'
  }
}

const { data } = await useFetch<{ status: string, commit: string | null, config: { b24App?: boolean, onecMock?: boolean, onec?: boolean } }>('/api/health', { server: false })
// Адрес сайта одинаков на сервере и в браузере — иначе разметка расходится при гидратации (#76).
const origin = useRequestURL().origin

onMounted(() => {
  // Страница открывается и вне портала (прямая ссылка) — фрейм нужен только для его оформления.
  openB24Frame().then((f) => {
    frame = f
  }).catch(() => {})
})
</script>

<template>
  <B24Container class="py-6 flex flex-col gap-4 max-w-3xl">
    <B24Tabs :items="tabs" default-value="about" @update:model-value="(v: string | number) => { if (v === 'trips') loadTrips() }">
      <template #about>
        <div class="flex flex-col gap-4 pt-4">
    <B24Alert
      v-if="data?.config.b24App"
      color="air-primary-success"
      title="Приложение подключено"
      :description="`Сервер ЛК работает с порталом. Сборка ${data.commit ?? '—'}.`"
    />
    <B24Alert
      v-else-if="data"
      color="air-primary-alert"
      title="Сервер ЛК ещё не подключён к порталу"
      description="Проверьте B24_CLIENT_ID, B24_CLIENT_SECRET и B24_PORTAL_HOST в .env на сервере, выполните make prod-up и нажмите «Переустановить» в настройках приложения."
    />
    <B24Alert
      v-if="data?.config.onecMock"
      color="air-secondary"
      title="1С — пока демо-данные"
      description="Каталог, цены и договоры берутся из имитации 1С, пока не подключена настоящая база."
    />

    <B24Card>
      <div class="flex flex-col gap-3 text-sm">
        <p class="font-semibold text-base">
          Как дать клиенту доступ
        </p>
        <ol class="list-decimal pl-5 flex flex-col gap-1">
          <li>Компании клиентов приходят из 1С сами — каждые 10 минут.</li>
          <li>Добавьте в компанию контакт сотрудника клиента с телефоном или email.</li>
          <li>В карточке компании откройте вкладку <b>«Личный кабинет»</b> и нажмите «Выдать доступ».</li>
          <li>Передайте клиенту ключ и адрес входа: <b>{{ origin }}/login</b>.</li>
        </ol>
        <p>
          Выдавать и отзывать ключи может ответственный за компанию или администратор портала.
          Заявки клиентов приходят сделками в воронку «Заявки ЛК».
        </p>
      </div>
    </B24Card>
        </div>
      </template>
      <template #trips>
        <div class="flex flex-col gap-3 pt-4">
          <p class="text-sm">
            Рейсы на сегодня и неделю вперёд — из заданий на перевозку 1С. Править график и рейсы — в 1С.
          </p>
          <B24Alert v-if="tripsError" color="air-primary-alert" :title="tripsError" />
          <p v-else-if="trips === null" class="text-sm">
            Загружаем…
          </p>
          <p v-else-if="trips.length === 0" class="text-sm">
            Рейсов на ближайшую неделю нет.
          </p>
          <div v-for="d in byDay" :key="d.day" class="flex flex-col gap-2">
            <p class="font-semibold">
              {{ d.day }}
            </p>
            <B24Card v-for="t in d.trips" :key="t.guid">
              <div class="flex flex-col gap-1 text-sm">
                <div class="flex flex-wrap items-center gap-2">
                  <b>{{ t.regions.join(', ') || 'Регион не указан' }}</b>
                  <B24Badge :color="TRIP_STATUS[t.status].color" :label="TRIP_STATUS[t.status].label" />
                  <span>выезд {{ time(t.actualStart ?? t.plannedStart) }}<template v-if="t.vehicle"> · {{ t.vehicle }}</template> · {{ t.number }}</span>
                </div>
                <p v-if="t.orders.length === 0">
                  Заказов пока нет
                </p>
                <p v-for="o in t.orders" :key="o.orderGuid">
                  {{ o.clientName ?? 'Клиент не из ЛК' }} — заказ {{ o.number }}
                </p>
              </div>
            </B24Card>
          </div>
        </div>
      </template>
    </B24Tabs>
  </B24Container>
</template>
