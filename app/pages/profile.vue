<!-- Профиль: договор из 1С и менеджер — «Позвонить» открывает звонилку телефона. -->
<script setup lang="ts">
useHead({ title: 'Профиль' })

const { data, error } = await useFetch('/api/profile', { headers: useRequestHeaders(['cookie']) })
if (error.value?.statusCode === 401) await navigateTo('/login')

const money = (v: number, currency: string) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(v)
const date = (iso: string) => new Date(iso).toLocaleDateString('ru-RU')
</script>

<template>
  <div class="pb-16 md:pb-0">
    <B24Header :title="data?.company.title || 'Профиль'" to="/" />
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
