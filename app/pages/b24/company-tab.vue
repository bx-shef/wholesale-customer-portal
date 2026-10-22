<!--
  Вкладка «Личный кабинет» в карточке компании (docs/spec.md §3): менеджер выдаёт и отзывает
  ключи контактам компании. Ключ показывается один раз — в CRM хранится только его хэш.
-->
<script setup lang="ts">
import type { B24Frame } from '@bitrix24/b24jssdk'

useHead({ title: 'Личный кабинет' })

interface Contact { id: number, name: string, phones: string[], emails: string[], access: 'none' | 'active' | 'revoked' | 'expired', expiresAt: string | null }

const ACCESS_LABEL = {
  none: { label: 'Нет доступа', color: 'air-secondary' },
  active: { label: 'Доступ есть', color: 'air-primary-success' },
  // «Отозван» — любой неактивный статус: запись могли выключить и руками в CRM.
  revoked: { label: 'Неактивен', color: 'air-secondary-alert' },
  expired: { label: 'Истёк', color: 'air-primary-warning' },
} as const

let b24: B24Frame | null = null
const companyId = ref<number | null>(null)
const contacts = ref<Contact[]>([])
const hasGuid = ref(true)
const loading = ref(true)
const busy = ref<number | null>(null)
const error = ref('')
const issued = ref<{ contact: Contact, key: string } | null>(null)
const confirmRevoke = ref<number | null>(null)
const copied = ref(false)
// Адрес сайта одинаков на сервере и в браузере — иначе разметка расходится при гидратации (#76).
const origin = useRequestURL().origin

async function api<T>(action: 'list' | 'issue' | 'revoke', contactId?: number): Promise<T> {
  const auth = b24?.auth.getAuthData()
  if (!auth || !companyId.value) throw new Error('Нет авторизации портала — обновите страницу')
  return $fetch<T>('/api/b24/company-tab', {
    method: 'POST',
    body: { domain: auth.domain, authId: auth.access_token, companyId: companyId.value, action, contactId },
  })
}

const message = (e: unknown) => (e as { data?: { message?: string } }).data?.message || (e as Error).message || 'Ошибка'

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await api<{ contacts: Contact[], hasGuid?: boolean }>('list')
    contacts.value = r.contacts
    hasGuid.value = r.hasGuid !== false
  }
  catch (e) {
    error.value = message(e)
  }
  finally {
    loading.value = false
  }
}

async function issue(c: Contact) {
  busy.value = c.id
  error.value = ''
  copied.value = false
  try {
    const { key } = await api<{ key: string }>('issue', c.id)
    issued.value = { contact: c, key }
    await load()
  }
  catch (e) {
    error.value = message(e)
  }
  finally {
    busy.value = null
  }
}

async function revoke(c: Contact) {
  // Второй клик подтверждает: confirm() в части фреймов заблокирован.
  if (confirmRevoke.value !== c.id) {
    confirmRevoke.value = c.id
    return
  }
  confirmRevoke.value = null
  busy.value = c.id
  error.value = ''
  try {
    await api('revoke', c.id)
    if (issued.value?.contact.id === c.id) issued.value = null
    await load()
  }
  catch (e) {
    error.value = message(e)
  }
  finally {
    busy.value = null
  }
}

async function copy() {
  if (!issued.value) return
  await navigator.clipboard.writeText(issued.value.key).then(() => (copied.value = true), () => {})
}

onMounted(async () => {
  try {
    b24 = await openB24Frame()
    companyId.value = companyIdFromOptions(b24.placement.options)
    if (!companyId.value) throw new Error('Вкладка открыта не из карточки компании')
    await load()
  }
  catch (e) {
    loading.value = false
    error.value = (e as Error).message === 'outside-portal' ? 'Вкладка открывается только из карточки компании в Битрикс24.' : message(e)
  }
})
</script>

<template>
  <B24Container class="py-4 flex flex-col gap-3 max-w-3xl">
    <B24Alert v-if="error" color="air-primary-alert" :title="error" />

    <B24Card v-if="issued">
      <div class="flex flex-col gap-2">
        <p class="font-semibold">
          Ключ для {{ issued.contact.name }}
        </p>
        <p class="text-sm">
          Передайте клиенту ключ и адрес входа. Ключ показывается один раз: закроете — останется только перевыпустить.
        </p>
        <div class="flex items-center gap-2">
          <B24Input :model-value="issued.key" readonly class="font-mono flex-1" />
          <B24Button color="air-primary" :label="copied ? 'Скопировано' : 'Копировать'" @click="copy" />
        </div>
        <p class="text-sm">
          Вход: {{ origin }}/login — телефон или email контакта и этот ключ.
        </p>
        <B24Button color="air-tertiary" label="Готово, скрыть ключ" @click="issued = null" />
      </div>
    </B24Card>

    <B24Alert
      v-if="!loading && !hasGuid"
      color="air-primary-alert"
      title="У компании нет GUID 1С"
      description="Доступ выдаётся только компаниям из 1С: по GUID ЛК берёт договор, цены и адреса. Дождитесь, пока компания придёт из 1С, или проверьте её поле «Внешний код» (ORIGIN_ID)."
    />

    <B24Card v-if="loading">
      <p class="text-sm">
        Загружаем контакты…
      </p>
    </B24Card>

    <B24Card v-else-if="!error && contacts.length === 0">
      <p class="text-sm">
        У компании нет контактов. Добавьте контакт клиента в карточку компании — и выдайте ему доступ здесь.
      </p>
    </B24Card>

    <B24Card v-for="c in contacts" :key="c.id">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-col gap-1 min-w-0">
          <p class="font-semibold">
            {{ c.name }}
          </p>
          <p class="text-sm">
            {{ [...c.phones, ...c.emails].join(' · ') || 'Нет телефона и email — войти будет нечем' }}
          </p>
          <div>
            <B24Badge :color="ACCESS_LABEL[c.access].color" :label="ACCESS_LABEL[c.access].label" />
          </div>
        </div>
        <div class="flex gap-2">
          <B24Button
            color="air-primary"
            :loading="busy === c.id"
            :disabled="busy !== null || !hasGuid"
            :label="c.access === 'none' ? 'Выдать доступ' : 'Новый ключ'"
            @click="issue(c)"
          />
          <B24Button
            v-if="c.access === 'active'"
            color="air-secondary-alert"
            :disabled="busy !== null"
            :label="confirmRevoke === c.id ? 'Точно отозвать?' : 'Отозвать'"
            @click="revoke(c)"
          />
        </div>
      </div>
    </B24Card>
  </B24Container>
</template>
