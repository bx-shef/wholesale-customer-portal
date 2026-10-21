/**
 * Страница стенда 1С — самодостаточный HTML без сборки: её открывает программист 1С, у
 * которого нет ЛК. Токен уходит POST-ом на сервер ЛК и нигде не сохраняется.
 */
export const ONEC_TEST_PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Проверка сервиса 1С — ЛК Алгена</title>
<style>
  :root { color-scheme: light; --line: #dfe3e8; --muted: #5d6670; --ok: #1b8a3a; --fail: #c62828; --skip: #8a6d00; --accent: #0075ff; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #eef2f4; color: #1f2329; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 48px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  header img { height: 32px; }
  h1 { font-size: 20px; margin: 0; }
  .card { background: #fff; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  p.muted, .muted { color: var(--muted); }
  label { display: block; font-weight: 600; margin: 12px 0 4px; }
  input[type=text], input[type=url], input[type=password] { width: 100%; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; font: inherit; }
  .row { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
  .row label { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-weight: 400; }
  button { margin-top: 16px; padding: 10px 20px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  button.secondary { margin-top: 0; padding: 6px 12px; background: transparent; color: var(--accent); border: 1px solid var(--accent); }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 6px; border-top: 1px solid var(--line); vertical-align: top; }
  td.st { width: 72px; font-weight: 700; white-space: nowrap; }
  td.ms { width: 72px; text-align: right; color: var(--muted); white-space: nowrap; }
  .ok { color: var(--ok); } .fail { color: var(--fail); } .skip { color: var(--skip); }
  .summary { font-weight: 600; margin-bottom: 8px; }
  .err { color: var(--fail); font-weight: 600; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <header><img src="/logo.png" alt=""><h1>Проверка связи с 1С для ЛК</h1></header>
  <div class="card">
    <p class="muted">Стенд по очереди вызывает методы контракта <b>с сервера ЛК</b> и сверяет ответы с описанием:
    <a href="https://github.com/bx-shef/wholesale-customer-portal/blob/main/docs/onec-contract.md" target="_blank" rel="noopener">спецификация</a>.
    Все запросы идут с заголовком <code>X-LK-Test: 1</code>. Сервер ЛК токен и пароль не сохраняет и в журнал не пишет.</p>
    <form id="f" autocomplete="off">
      <div class="row">
        <label><input type="radio" name="target" value="onec" checked> Сервис 1С</label>
        <label><input type="radio" name="target" value="odata"> OData 1С — разведка полей</label>
        <label><input type="radio" name="target" value="odata-catalog"> OData 1С — каталог</label>
        <label><input type="radio" name="target" value="odata-prices"> OData 1С — цены и остатки</label>
        <label><input type="radio" name="target" value="mock"> Мок ЛК (эталон контракта)</label>
      </div>
      <div id="onec-fields">
        <label for="baseUrl">Базовый адрес сервиса</label>
        <input id="baseUrl" name="onec-base-url" type="url" inputmode="url" spellcheck="false" placeholder="https://1c.algena.by/base/hs/lk" autocomplete="off">
        <div class="row">
          <label><input type="radio" name="authKind" value="bearer" checked> Токен (Bearer)</label>
          <label><input type="radio" name="authKind" value="basic"> Логин и пароль 1С (Basic)</label>
        </div>
        <div id="bearer-fields">
          <label for="token">Токен</label>
          <input id="token" type="password" autocomplete="off">
        </div>
        <div id="basic-fields" hidden>
          <label for="login">Логин пользователя 1С</label>
          <input id="login" name="onec-login" type="text" autocomplete="off">
          <label for="password">Пароль</label>
          <input id="password" type="password" autocomplete="off">
        </div>
      </div>
      <div class="row">
        <label><input id="allowOrder" type="checkbox"> Проверить создание заказа — уходит с <code>test: true</code>; если 1С тестовый документ всё же создаёт, — только на тестовой базе</label>
      </div>
      <div class="row">
        <label><input id="remember" type="checkbox"> Запомнить адрес и доступ на этом устройстве (пароль и токен — зашифрованы ключом браузера)</label>
        <button id="forget" type="button" class="secondary" hidden>Забыть доступ</button>
      </div>
      <button id="go" type="submit">Проверить</button>
    </form>
  </div>
  <div class="card" id="report" hidden></div>
</main>
<script>
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const target = () => document.querySelector('input[name=target]:checked').value
  const applyTarget = () => { $('onec-fields').hidden = target() === 'mock'; $('baseUrl').placeholder = target().startsWith('odata') ? 'https://1c.algena.by:8202/KA_Work_test/odata/standard.odata' : 'https://1c.algena.by/base/hs/lk' }
  // Выбранный режим помним всегда: это не доступ, шифровать нечего.
  const TARGET_KEY = 'lk-onec-test-target'
  try {
    const savedTarget = localStorage.getItem(TARGET_KEY)
    const radio = savedTarget && document.querySelector('input[name=target][value="' + CSS.escape(savedTarget) + '"]')
    if (radio) radio.checked = true
  }
  catch {}
  applyTarget()
  document.querySelectorAll('input[name=target]').forEach((r) => r.addEventListener('change', () => {
    applyTarget()
    try { localStorage.setItem(TARGET_KEY, target()) } catch {}
  }))
  const authKind = () => document.querySelector('input[name=authKind]:checked').value
  // Видимость полей — по отмеченному способу всегда, в том числе после того, как браузер сам
  // восстановил отметки при возврате на страницу (событие change при этом не приходит).
  const applyAuth = () => { $('basic-fields').hidden = authKind() !== 'basic'; $('bearer-fields').hidden = authKind() === 'basic' }
  applyAuth()
  window.addEventListener('pageshow', () => { applyAuth(); applyTarget() })
  document.querySelectorAll('input[name=authKind]').forEach((r) => r.addEventListener('change', applyAuth))
  // Длительность по-человечески: «850 мс», «12 с», «2 мин 45 с».
  const dur = (ms) => {
    if (ms < 1000) return ms + ' мс'
    const sec = Math.round(ms / 1000)
    return sec < 60 ? sec + ' с' : Math.floor(sec / 60) + ' мин' + (sec % 60 ? ' ' + (sec % 60) + ' с' : '')
  }
  const LABEL = { ok: 'ОК', fail: 'Ошибка', skip: 'Пропуск' }

  /*
   * «Запомнить на этом устройстве»: адрес и логин — открыто, пароль и токен — AES-GCM ключом,
   * который браузер создаёт неэкспортируемым и держит в IndexedDB. В localStorage — только
   * шифротекст: скопировать его на другой компьютер и расшифровать нельзя. Скрипт на самой
   * странице расшифровать может — это защита от утечки хранилища, а не от взлома страницы.
   */
  const STORE = 'lk-onec-test'
  function keyDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(STORE, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('keys')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  const idb = (db, mode, fn) => new Promise((resolve, reject) => {
    const tx = db.transaction('keys', mode)
    const req = fn(tx.objectStore('keys'))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
  })
  async function cryptoKey(create) {
    const db = await keyDb()
    let key = await idb(db, 'readonly', (s) => s.get('k'))
    if (!key && create) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await idb(db, 'readwrite', (s) => s.put(key, 'k'))
    }
    return key || null
  }
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  async function seal(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(true), new TextEncoder().encode(text))
    return b64(iv) + '.' + b64(data)
  }
  async function unseal(sealed) {
    const key = await cryptoKey(false)
    if (!key || !sealed) return ''
    const [iv, data] = sealed.split('.')
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(data)))
  }
  async function remember() {
    const secret = authKind() === 'basic' ? $('password').value : $('token').value
    localStorage.setItem(STORE, JSON.stringify({ baseUrl: $('baseUrl').value, authKind: authKind(), login: $('login').value, secret: await seal(secret) }))
    $('forget').hidden = false
  }
  async function forget(clearFields) {
    localStorage.removeItem(STORE)
    // Ключ тоже удаляем: старый шифротекст, если где-то остался, расшифровать будет нечем.
    try { indexedDB.deleteDatabase(STORE) } catch {}
    $('forget').hidden = true
    if (!clearFields) return
    $('remember').checked = false
    $('token').value = ''
    $('password').value = ''
  }
  $('forget').addEventListener('click', () => { forget(true).catch(() => {}) })
  ;(async () => {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null')
    if (!saved) return
    $('baseUrl').value = saved.baseUrl || ''
    $('login').value = saved.login || ''
    document.querySelector('input[name=authKind][value="' + (saved.authKind === 'basic' ? 'basic' : 'bearer') + '"]').checked = true
    $('basic-fields').hidden = saved.authKind !== 'basic'
    $('bearer-fields').hidden = saved.authKind === 'basic'
    $('remember').checked = true
    $('forget').hidden = false
    try {
      $(saved.authKind === 'basic' ? 'password' : 'token').value = await unseal(saved.secret)
    }
    catch {
      // Ключ браузера потерян (очистка данных сайта) — шифротекст бесполезен, просим ввести заново.
      localStorage.removeItem(STORE)
    }
  })().catch(() => {})
  // Поля OData — только имена и типы: значений стенд не читает.
  const fieldsHtml = (types) => !types ? '' : '<details><summary>Поля</summary>' + types.map((t) => '<p><b>' + esc(t.name) + '</b><br><code>'
    + t.properties.map((p) => esc(p.type ? p.name + ': ' + p.type : p.name)).join('<br>') + '</code></p>').join('') + '</details>'
  $('f').addEventListener('submit', async (e) => {
    e.preventDefault()
    if (target() !== 'mock') {
      if ($('remember').checked) await remember().catch(() => {})
      else if (localStorage.getItem(STORE)) await forget(false).catch(() => {})
    }
    const report = $('report')
    $('go').disabled = true
    report.hidden = false
    report.innerHTML = '<p class="muted">Проверяем… до минуты на медленной базе.</p>'
    try {
      const res = await fetch('/api/onec-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-lk-stand': '1' },
        body: JSON.stringify({ target: target(), baseUrl: $('baseUrl').value, authKind: authKind(), token: $('token').value, login: $('login').value, password: $('password').value, allowOrder: $('allowOrder').checked }),
      })
      let data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status))
      // Долгий прогон идёт в фоне: опрашиваем каждые 2 с, не дольше 5 минут, и показываем, сколько прошло.
      if (data.job) {
        const t0 = Date.now()
        var lastLog = []
        for (;;) {
          await new Promise((r) => setTimeout(r, 2000))
          const sec = Math.round((Date.now() - t0) / 1000)
          if (sec > 300) throw new Error('Прогон идёт дольше 5 минут — 1С отвечает слишком медленно. Последние запросы:\\n' + lastLog.slice(-15).join('\\n'))
          const logHtml = (lines) => (lines && lines.length) ? '<pre class="muted">' + esc(lines.slice(-15).join('\\n')) + '</pre>' : ''
          report.innerHTML = '<p class="muted">Проверяем… ' + dur(sec * 1000) + '</p>' + logHtml(lastLog)
          const r = await fetch('/api/onec-test/result?id=' + encodeURIComponent(data.job), { headers: { 'x-lk-stand': '1' } })
          const j = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error((j.message || ('HTTP ' + r.status)) + ((j.data && j.data.log && j.data.log.length) ? '\\nЗапросы к 1С:\\n' + j.data.log.slice(-15).join('\\n') : ''))
          lastLog = j.log || lastLog
          if (j.status === 'done') { data = j.result; data.log = j.log; break }
        }
      }
      const ok = data.checks.filter((c) => c.status === 'ok').length
      const fail = data.checks.filter((c) => c.status === 'fail').length
      report.innerHTML = '<div class="summary ' + (fail ? 'fail' : 'ok') + '">' + esc(data.target) + ': пройдено ' + ok + ' из ' + data.checks.length
        + (fail ? ', ошибок ' + fail : ' — сервис отвечает по контракту') + ' · ' + dur(data.ms) + '</div><table>'
        + data.checks.map((c) => '<tr><td class="st ' + c.status + '">' + LABEL[c.status] + '</td><td><b>' + esc(c.title) + '</b><br><span class="muted">' + esc(c.detail) + '</span>' + fieldsHtml(c.fields) + '</td><td class="ms">' + (c.status === 'skip' ? '' : dur(c.ms)) + '</td></tr>').join('')
        + '</table>' + ((data.log && data.log.length) ? '<details><summary>Журнал запросов к 1С (' + data.log.length + ')</summary><pre>' + esc(data.log.join('\\n')) + '</pre></details>' : '') + (data.fieldsText ? '<button id="copy" type="button" class="secondary">Скопировать поля для разработчика</button>' : '')
      if (data.fieldsText) $('copy').addEventListener('click', () => navigator.clipboard.writeText(data.fieldsText).then(() => { $('copy').textContent = 'Скопировано' }))
    }
    catch (err) {
      report.innerHTML = '<p class="err" style="white-space: pre-wrap">' + esc(err.message) + '</p>'
    }
    finally {
      $('go').disabled = false
    }
  })
</script>
</body>
</html>
`
