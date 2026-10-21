<!-- Вход сотрудника клиента: телефон или email контакта + ключ от менеджера (docs/spec.md §3). -->
<script setup lang="ts">
useHead({ title: 'Вход' })

const login = ref('')
const key = ref('')
const pending = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  pending.value = true
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { login: login.value, key: key.value } })
    // Кэш каталога — цены прежнего вошедшего: новому их не показываем.
    await clearCatalogCache()
    await navigateTo('/')
  }
  catch (e) {
    // Текст отказа приходит с сервера: один и тот же для любой причины, кроме лимита попыток.
    error.value = (e as { data?: { message?: string } }).data?.message || 'Не удалось войти. Попробуйте позже.'
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <div>
    <B24Header title="Личный кабинет" :toggle="false">
      <template #title>
        <span class="flex items-center gap-3">
          <img src="/logo.png" alt="Алгена" class="h-7 w-auto">
          <span>Личный кабинет</span>
        </span>
      </template>
    </B24Header>
    <B24Main>
      <B24Container class="py-8 max-w-md">
        <B24Card>
          <form class="flex flex-col gap-4" @submit.prevent="submit">
            <B24FormField label="Телефон или email" name="login" required>
              <B24Input v-model="login" autocomplete="username" inputmode="email" class="w-full" />
            </B24FormField>
            <B24FormField label="Ключ доступа" name="key" required description="Ключ выдаёт ваш менеджер.">
              <B24Input v-model="key" type="password" autocomplete="current-password" class="w-full" />
            </B24FormField>
            <B24Alert v-if="error" color="air-primary-alert" :title="error" />
            <B24Button type="submit" color="air-primary" block :loading="pending" label="Войти" />
          </form>
        </B24Card>
      </B24Container>
    </B24Main>
  </div>
</template>
