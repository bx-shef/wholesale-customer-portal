<!-- Профиль: договор из 1С и менеджер — «Позвонить» открывает звонилку телефона. -->
<script setup lang="ts">
useHead({ title: 'Профиль' })

const { data, error } = await useFetch('/api/profile', { headers: useRequestHeaders(['cookie']) })
if (error.value?.statusCode === 401) await navigateTo('/login')

const money = (v: number, currency: string) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(v)
const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU')

const calling = ref(false)
const callbackSent = ref(false)
const callbackError = ref('')
async function requestCallback() {
  calling.value = true
  callbackError.value = ''
  try {
    await $fetch('/api/callback', { method: 'POST' })
    callbackSent.value = true
  }
  catch {
    callbackError.value = 'Не удалось передать просьбу. Позвоните менеджеру или попробуйте позже.'
  }
  finally {
    calling.value = false
  }
}
</script>

<template>
  <div class="pb-16 md:pb-0">
    <AppHeader title="Профиль" />
    <B24Main>
      <B24Container class="py-6 flex flex-col gap-4 max-w-xl">
        <B24Alert v-if="error && error.statusCode !== 401" color="air-primary-warning" title="Не удалось загрузить профиль. Обновите страницу." />
        <template v-else-if="data">
          <B24Card>
            <template #header>
              <h2 class="font-semibold">
                Договор
              </h2>
            </template>
            <dl v-if="data.contract" class="grid grid-cols-2 gap-2 text-sm">
              <dt>Номер</dt><dd>{{ data.contract.number }} от {{ date(data.contract.date) }}</dd>
              <dt>Отсрочка</dt><dd>{{ data.contract.paymentDelayDays }} дн.</dd>
              <dt>Кредитный лимит</dt><dd>{{ money(data.contract.creditLimit, data.contract.currency) }}</dd>
              <dt>Задолженность</dt><dd>{{ money(data.contract.debt, data.contract.currency) }}</dd>
            </dl>
            <p v-else class="text-sm">
              Данные договора сейчас недоступны.
            </p>
          </B24Card>
          <B24Card>
            <template #header>
              <h2 class="font-semibold">
                Ваш менеджер
              </h2>
            </template>
            <div v-if="data.manager" class="flex flex-col gap-3 text-sm">
              <p>{{ data.manager.name }}</p>
              <p v-if="data.manager.email">
                {{ data.manager.email }}
              </p>
              <B24Button v-if="data.manager.phone" :to="`tel:${data.manager.phone}`" color="air-primary" block label="Позвонить" />
              <p class="text-sm text-(--ui-color-design-plain-na-content-secondary)">
                Не дозвонились или нужен совет? Нажмите — менеджер получит в CRM задачу перезвонить вам на номер из карточки.
              </p>
              <B24Button color="air-secondary" block :loading="calling" :disabled="callbackSent" :label="callbackSent ? 'Менеджер перезвонит' : 'Заказать звонок'" @click="requestCallback" />
              <B24Alert v-if="callbackError" color="air-primary-alert" :title="callbackError" />
            </div>
            <p v-else class="text-sm">
              Менеджер не назначен.
            </p>
          </B24Card>
        </template>
      </B24Container>
    </B24Main>
    <BottomNav />
  </div>
</template>
