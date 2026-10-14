<!--
  Главная страница локального приложения в коробке (пункт меню слева, «Перейти к приложению»).
  Вкладка «Личный кабинет» живёт отдельно — в карточке компании (placement CRM_COMPANY_DETAIL_TAB,
  /b24/company-tab). Здесь — состояние подключения и как работать с ЛК.
-->
<script setup lang="ts">
useHead({ title: 'Личный кабинет' })

const { data } = await useFetch<{ status: string, commit: string | null, config: { b24App?: boolean, onecMock?: boolean, onec?: boolean } }>('/api/health', { server: false })
const origin = import.meta.client ? window.location.origin : ''

onMounted(() => {
  // Страница открывается и вне портала (прямая ссылка) — фрейм нужен только для его оформления.
  openB24Frame().catch(() => {})
})
</script>

<template>
  <B24Container class="py-6 flex flex-col gap-4 max-w-3xl">
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
  </B24Container>
</template>
