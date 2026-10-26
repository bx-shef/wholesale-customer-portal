/**
 * Выход из кабинета — один на меню и на экраны ошибок данных клиента (клиент без компании в 1С
 * иначе застревал на ошибке без выхода, стенд 2026-10-26). Сначала стираем сохранённое на
 * устройстве, потом закрываем сессию на сервере; без сети «вышли» не показываем.
 */
export function useLogout() {
  const cart = useCart()
  const logoutError = useState('logout-error', () => '')

  async function logout() {
    logoutError.value = ''
    // Сохранённое с устройства уходит в любом случае.
    cart.forget()
    // Поиск и фильтры прежнего пользователя на общем устройстве не оставляем.
    try { localStorage.removeItem('wcp-catalog-filters') }
    catch { /* хранилище недоступно — стирать нечего */ }
    await clearCatalogCache()
    // Данные клиента из 1С — следующему вошедшему не показываем.
    clearNuxtState('client-data')
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    }
    catch {
      // Без сети сервер сессию не закрыл: «вышли» показывать нельзя — следующий вошёл бы под ней.
      logoutError.value = 'Выйти не удалось: нет связи с сервером. Повторите, когда появится сеть.'
      return
    }
    // Сессии больше нет: меню и название компании не должны пережить выход.
    const me = useNuxtData('me')
    me.data.value = undefined
    clearNuxtData('me')
    await navigateTo('/login')
  }

  return { logout, logoutError }
}
