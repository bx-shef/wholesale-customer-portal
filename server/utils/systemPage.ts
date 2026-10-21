/**
 * Страница «Состояние системы» — самодостаточный HTML, как стенд 1С: открывает владелец или
 * программист без сборки. Данные — `/api/system/status`, обновление раз в 15 секунд.
 */
export const SYSTEM_PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Состояние системы — ЛК Алгена</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #eef2f4; color: #1f2329; }
  main { max-width: 1000px; margin: 0 auto; padding: 20px 16px 48px; }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  header img { height: 30px; }
  h1 { font-size: 20px; margin: 0; flex: 1; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  .card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  .muted { color: #5d6670; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 600; color: #5d6670; font-size: 12px; padding: 4px 6px; }
  td { padding: 6px; border-top: 1px solid #e6e9ec; vertical-align: top; }
  .b { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; font-weight: 700; color: #fff; }
  .ok { background: #1b8a3a; } .failing, .failed { background: #c62828; } .stale { background: #b26a00; } .never, .running { background: #7a8691; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
  .tile { background: #f5f7f9; border-radius: 8px; padding: 8px 10px; }
  .tile b { display: block; font-size: 20px; }
  button { padding: 6px 12px; border: 0; border-radius: 8px; background: #0075ff; color: #fff; font: inherit; font-weight: 600; cursor: pointer; margin: 2px; }
  button.sec { background: #e6f0ff; color: #0058c4; }
  button:disabled { opacity: .5; cursor: wait; }
  .alert { color: #c62828; font-weight: 600; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f5f7f9; padding: 8px; border-radius: 8px; margin: 8px 0 0; font-size: 12px; max-height: 260px; overflow: auto; }
  @media (max-width: 640px) { .hide-m { display: none; } }
</style>
</head>
<body>
<main>
  <header><img src="/logo.png" alt=""><h1>Состояние системы</h1><span class="muted" id="updated"></span></header>

  <div class="card" id="summary"></div>

  <div class="card">
    <h2>Обмен с 1С</h2>
    <p class="muted" style="margin-top:0">К 1С ходит только расписание. «Запустить» — внеочередной обмен, не больше 60 в час.</p>
    <table><thead><tr><th>Поток</th><th>Состояние</th><th>Последний удачный</th><th class="hide-m">Последний запуск</th><th></th></tr></thead><tbody id="flows"></tbody></table>
  </div>

  <div class="card"><h2>База ЛК</h2><div class="grid" id="counts"></div></div>

  <div class="card" id="mock-card" hidden>
    <h2>Проверка синхронизации на моке</h2>
    <p class="muted" style="margin-top:0">Шаг 1 — «поменяйте 1С» кнопкой ниже. Шаг 2 — запустите нужный обмен в таблице выше
    (или дождитесь расписания). Шаг 3 — проверьте, что счётчики и «получено» изменились, а в ЛК видно новое.</p>
    <div>
      <button class="sec" data-mock="price">Цены: +5% на 3 товара → обмен «прайс»</button>
      <button class="sec" data-mock="debt">Долг клиента +100 → обмен «клиенты»</button>
      <button class="sec" data-mock="item">Переименовать товар → обмен «каталог»</button>
      <button class="sec" data-mock="client">Новый клиент → обмен «клиенты»</button>
      <button class="sec" data-mock="fail">Сбой 1С: 6 ответов 503</button>
      <button class="sec" data-mock="heal">1С починили (снять сбой и паузу)</button>
      <button class="sec" data-mock="reset">Сбросить мок</button>
    </div>
    <pre id="mock-out" hidden></pre>
  </div>

  <div class="card">
    <h2>Оповещения в Telegram</h2>
    <p id="tg" class="muted"></p>
    <button class="sec" id="tg-test">Отправить пробное сообщение</button>
    <pre id="tg-out" hidden></pre>
  </div>

  <div class="card">
    <h2>Последние запуски</h2>
    <table><thead><tr><th>Время</th><th>Поток</th><th>Итог</th><th>Получено</th><th class="hide-m">Ошибка</th></tr></thead><tbody id="runs"></tbody></table>
  </div>
</main>
<script>
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const ago = (iso) => {
    if (!iso) return '—'
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
    const t = new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    return t + ' · ' + (m < 1 ? 'только что' : m < 60 ? m + ' мин назад' : Math.round(m / 60) + ' ч назад')
  }
  const STATE = { ok: 'в порядке', failing: 'падает', stale: 'давно не было', never: 'ещё не было' }
  const RUN = { done: 'ок', failed: 'ошибка', running: 'идёт' }
  const FLOWS = { clients: 'клиенты и договоры', catalog: 'каталог', prices: 'прайс', stock: 'остатки', orders: 'статусы заказов', schedule: 'график доставки', trips: 'рейсы' }
  async function api(path, body) {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-lk-stand': '1' }, body: JSON.stringify(body) } : {})
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status))
    return data
  }
  async function load() {
    const s = await api('/api/system/status')
    $('updated').textContent = 'обновлено ' + new Date().toLocaleTimeString('ru-RU') + ' · сборка ' + s.commit.slice(0, 7)
    const mode = { mock: 'мок 1С', real: 'настоящая 1С', odata: 'настоящая 1С по OData', off: '1С не настроена' }[s.onec.mode]
    $('summary').innerHTML = '<b>' + esc(mode) + '</b>'
      + (s.onec.pausedUntil ? ' · <span class="alert">обращения к 1С на паузе до ' + esc(ago(s.onec.pausedUntil).split(' · ')[0]) + '</span>' : ' · сбоев подряд: ' + Number(s.onec.failuresInRow))
      + (s.alerts.length ? '<div class="alert" style="margin-top:6px">' + s.alerts.map((a) => '⚠️ ' + esc(a.text)).join('<br>') + '</div>' : '<div style="margin-top:6px;color:#1b8a3a;font-weight:600">✅ Проблем нет</div>')
    $('flows').innerHTML = s.flows.map((f) => '<tr><td><b>' + esc(f.label) + '</b></td><td><span class="b ' + f.state + '">' + STATE[f.state] + '</span>'
      + (f.failuresInRow ? ' <span class="muted">сбоев подряд: ' + Number(f.failuresInRow) + '</span>' : '') + '</td><td>' + esc(ago(f.lastOkAt)) + '</td><td class="hide-m">'
      + (f.lastRun ? '<span class="b ' + esc(f.lastRun.status) + '">' + esc(RUN[f.lastRun.status]) + '</span> ' + esc(ago(f.lastRun.startedAt)) + ', получено ' + Number(f.lastRun.received) : '—')
      + '</td><td><button data-run="' + f.flow + '">Запустить</button></td></tr>').join('')
    $('counts').innerHTML = Object.entries(s.counts).map(([k, v]) => '<div class="tile"><b>' + Number(v) + '</b>' + esc(k) + '</div>').join('')
      + Object.entries(s.orders).map(([k, v]) => '<div class="tile"><b>' + Number(v) + '</b>заявки: ' + esc(k) + '</div>').join('')
    $('runs').innerHTML = s.recentRuns.map((r) => '<tr><td>' + esc(ago(r.startedAt)) + '</td><td>' + esc(FLOWS[r.flow] || r.flow) + '</td><td><span class="b ' + r.status + '">' + RUN[r.status] + '</span></td><td>' + r.received + '</td><td class="hide-m muted">' + esc(r.error || '') + '</td></tr>').join('')
    $('mock-card').hidden = s.onec.mode !== 'mock'
    $('tg').textContent = s.telegram ? 'Включены: сообщение на каждую поломку обмена и на восстановление.' : 'Выключены: задайте TELEGRAM_ALERT_BOT_TOKEN и TELEGRAM_ALERT_CHAT_ID.'
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button')
    if (!b) return
    const out = (id, text) => { $(id).hidden = false; $(id).textContent = text }
    b.disabled = true
    try {
      if (b.dataset.run) {
        await api('/api/system/run', { flow: b.dataset.run })
        b.textContent = 'Запущено — итог в таблице ниже'
      }
      else if (b.dataset.mock) out('mock-out', JSON.stringify((await api('/api/system/mock', { action: b.dataset.mock })).body, null, 2))
      else if (b.id === 'tg-test') { const r = await api('/api/system/alert-test', {}); out('tg-out', r.ok ? 'Доставлено.' : 'Telegram ответил ' + r.status) }
    }
    catch (err) { alert(err.message) }
    finally { b.disabled = false; load().catch(() => {}) }
  })
  load().catch((err) => { $('summary').innerHTML = '<span class="alert">' + esc(err.message) + '</span>' })
  setInterval(() => load().catch(() => {}), 15000)
</script>
</body>
</html>
`
