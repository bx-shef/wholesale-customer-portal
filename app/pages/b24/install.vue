<!--
  Установка локального приложения на коробке. Токены коробка присылает POST-ом сюда же — их
  принимает сервер (server/routes/b24/[...path].post.ts) и передаёт итог параметром `app`.
  Не приняли — installFinish не зовём: портал оставит приложение неустановленным и откроет
  установку снова, когда ключи будут вписаны в .env.
-->
<script setup lang="ts">
useHead({ title: 'Установка' })

const route = useRoute()
const state = ref<'work' | 'done' | 'error'>('work')
const message = ref('')

onMounted(async () => {
  if (route.query.app !== 'ok') {
    state.value = 'error'
    message.value = 'Сервер ЛК не принял установку: проверьте B24_CLIENT_ID, B24_CLIENT_SECRET и B24_PORTAL_HOST в .env, выполните make prod-up и откройте приложение снова. Причина — в make logs.'
    return
  }
  try {
    const b24 = await openB24Frame()
    const call = async (method: string, params: Record<string, unknown>) => {
      const r = await b24.actions.v2.call.make({ method, params })
      if (!r.isSuccess) throw new Error(`${method}: ${r.getErrorMessages().join('; ')}`)
    }
    const handler = `${window.location.origin}/b24/company-tab`
    // Повторная установка: прежнюю привязку снимаем — у точки встройки одна регистрация,
    // и сменить адрес обработчика можно только так.
    await call('placement.unbind', { PLACEMENT: 'CRM_COMPANY_DETAIL_TAB', HANDLER: handler }).catch(() => {})
    await call('placement.bind', { PLACEMENT: 'CRM_COMPANY_DETAIL_TAB', HANDLER: handler, TITLE: 'Личный кабинет' })
    state.value = 'done'
    if (b24.isInstallMode) await b24.installFinish()
  }
  catch (e) {
    state.value = 'error'
    message.value = (e as Error).message === 'outside-portal' ? 'Страница открывается только из Битрикс24.' : String((e as Error).message)
  }
})
</script>

<template>
  <B24Container class="py-6 max-w-xl">
    <B24Alert v-if="state === 'work'" color="air-secondary" title="Регистрируем вкладку «Личный кабинет»…" />
    <B24Alert
      v-else-if="state === 'done'"
      color="air-primary-success"
      title="Готово: приложение подключено"
      description="В карточке компании появилась вкладка «Личный кабинет». Поля и смарт-процессы ЛК в CRM создаются в фоне за минуту-две."
    />
    <B24Alert v-else color="air-primary-alert" title="Не удалось установить" :description="message" />
  </B24Container>
</template>
