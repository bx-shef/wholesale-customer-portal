<!-- Профиль: договор из 1С и менеджер — «Позвонить» открывает звонилку телефона. -->
<script setup lang="ts">
useHead({ title: 'Профиль' })

const { data, error } = await useFetch('/api/profile', { headers: useRequestHeaders(['cookie']) })
if (error.value?.statusCode === 401) await navigateTo('/login')

const money = (v: number, currency: string) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(v)
const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk' })

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
  <AppPage id="profile" title="Профиль">
      <B24Container class="py-6 flex flex-col gap-4 max-w-xl">
        <B24Alert v-if="error && error.statusCode !== 401" color="air-primary-warning" title="Не удалось загрузить профиль. Обновите страницу." />
        <template v-else-if="data">
          <B24Alert v-if="data.shipmentBlocked" color="air-primary-warning" title="Отгрузка приостановлена" description="Заявки принимаем, но отгрузку сейчас подтверждает менеджер — обычно это вопрос оплаты. Свяжитесь с вашим менеджером." />
          <B24Card>
            <template #header>
              <h2 class="font-semibold">
                Компания
              </h2>
            </template>
            <p class="text-sm break-words">
              {{ data.company.title }}
            </p>
          </B24Card>
          <B24Card>
            <template #header>
              <h2 class="font-semibold">
                Договор
              </h2>
            </template>
            <dl v-if="data.contract" class="grid grid-cols-2 gap-2 text-sm">
              <dt>Номер</dt><dd>{{ data.contract.number }} от {{ date(data.contract.date) }}</dd>
              <!-- Отсрочку и задолженность 1С по OData пока не отдаёт (приходят нулями): ноль не показываем,
                   иначе клиент читает «отсрочки нет, долга нет» как факт. -->
              <template v-if="data.contract.paymentDelayDays > 0"><dt>Отсрочка</dt><dd>{{ data.contract.paymentDelayDays }} дн.</dd></template>
              <template v-if="data.contract.creditLimit > 0"><dt>Кредитный лимит</dt><dd>{{ money(data.contract.creditLimit, data.contract.currency) }}</dd></template>
              <template v-if="data.contract.debt > 0"><dt>Задолженность</dt><dd>{{ money(data.contract.debt, data.contract.currency) }}</dd></template>
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
              <!-- Тексты — позитивом, без указания на недоработку клиента (замечание владельца 2026-10-27). -->
              <!-- Блок выключается окружением: CALLBACK_ENABLED=false. -->
              <template v-if="data.callbackEnabled !== false">
              <p class="text-sm">
                Закажите звонок — менеджер вам перезвонит.
              </p>
              <B24Button color="air-secondary" block :loading="calling" :disabled="callbackSent" :label="callbackSent ? 'Менеджер перезвонит' : 'Заказать звонок'" @click="requestCallback" />
              <B24Alert v-if="callbackError" color="air-primary-alert" :title="callbackError" />
              </template>
            </div>
            <p v-else class="text-sm">
              Менеджер не назначен.
            </p>
          </B24Card>
        </template>
      </B24Container>
  </AppPage>
</template>
