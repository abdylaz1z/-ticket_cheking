import { firebaseConfig } from './config.js';

const $ = id => document.getElementById(id);
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const key = id => 'k' + String(id).trim().replace(/[.#$\/\[\]\s]/g, '-');
const tm = t => new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
const cmp = (a, b) => a.id.localeCompare(b.id, 'ru', { numeric: true });
// Распределение билетов по институтам: [с №, по №, название]
const RANGES = [[1, 80, 'ИМТИ'], [81, 118, 'ЭФ'], [119, 144, 'ФЭУ'], [145, 196, 'ФАИС'],
                [197, 248, 'ФТИП'], [249, 275, 'Коллеж'], [276, 313, 'ИМОПИО'], [314, 327, 'Микс']];
const facOf = n => { for (const [a, b, f] of RANGES) if (n >= a && n <= b) return f; return ''; };

let fac = '';
let D = {};          // { k12: {n, e, g, c} }  e = время входа, g = вход, n = имя
let store, filter = 'all', gate = '', msgTimer;
try { gate = localStorage.getItem('gate') || ''; } catch {}

const all = () => Object.keys(D).map(k => ({ id: k.slice(1), n: D[k].n || '', e: D[k].e || 0, g: D[k].g || '', f: D[k].f || '' })).sort(cmp);
const status = (t, c = '') => { const e = $('st'); e.textContent = t; e.className = 'st ' + c; };
const run = p => Promise.resolve(p).catch(() => { status('Не удалось сохранить. Проверьте правила базы.', 'bad'); });
const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

/* ---------- Хранилища ---------- */
async function firebaseStore() {
  const { initializeApp } = await import(FB + 'firebase-app.js');
  const m = await import(FB + 'firebase-database.js');
  const app = initializeApp(firebaseConfig);
  const db = m.getDatabase(app);
  if (firebaseConfig.anonymousAuth) {
    const a = await import(FB + 'firebase-auth.js');
    await a.signInAnonymously(a.getAuth(app));
  }
  const r = p => m.ref(db, p);
  return {
    sub: (cb, err) => m.onValue(r('tickets'), s => cb(s.val() || {}), err),
    // атомарная отметка: если два человека нажмут одновременно, зайдёт только один
    async mark(id, g) {
      const res = await m.runTransaction(r('tickets/' + key(id)), cur => {
        if (cur && cur.e) return;
        return { ...(cur || { c: 1 }), e: Date.now(), g: g || '' };
      });
      return { ok: res.committed, rec: res.snapshot.val() };
    },
    unmark: id => m.update(r('tickets/' + key(id)), { e: null, g: null }),
    add(items) {
      const u = {};
      items.forEach(({ id, name, f }) => { u[key(id) + '/c'] = 1; if (name) u[key(id) + '/n'] = name; if (f) u[key(id) + '/f'] = f; });
      return m.update(r('tickets'), u);
    },
    reset(ids) { const u = {}; ids.forEach(id => { u[key(id) + '/e'] = null; u[key(id) + '/g'] = null; }); return m.update(r('tickets'), u); },
    del: id => m.remove(r('tickets/' + key(id))),
    clear: () => m.remove(r('tickets')),
  };
}

function localStore() {
  const K = 'students-day-tickets-v1';
  let d = {}; try { d = JSON.parse(localStorage.getItem(K)) || {}; } catch {}
  let cb = () => {};
  const save = () => { try { localStorage.setItem(K, JSON.stringify(d)); } catch {} cb(d); };
  addEventListener('storage', e => { if (e.key === K) { try { d = JSON.parse(e.newValue) || {}; } catch {} cb(d); } });
  return {
    sub: f => { cb = f; f(d); },
    async mark(id, g) {
      const k = key(id); const cur = d[k];
      if (cur && cur.e) return { ok: false, rec: cur };
      d[k] = { ...(cur || { c: 1 }), e: Date.now(), g: g || '' }; save(); return { ok: true, rec: d[k] };
    },
    unmark: id => { const x = d[key(id)]; if (x) { delete x.e; delete x.g; save(); } },
    add: items => { items.forEach(({ id, name, f }) => { const x = (d[key(id)] ??= { c: 1 }); if (name) x.n = name; if (f) x.f = f; }); save(); },
    reset: ids => { ids.forEach(id => { const x = d[key(id)]; if (x) { delete x.e; delete x.g; } }); save(); },
    del: id => { delete d[key(id)]; save(); },
    clear: () => { d = {}; save(); },
  };
}

/* ---------- Сообщения ---------- */
function msg(type, text, btn) {
  const e = $('msg'); clearTimeout(msgTimer);
  e.className = 'msg ' + type; e.hidden = false;
  e.innerHTML = '<span>' + text + '</span>' + (btn ? `<button data-act="${btn.act}" data-id="${esc(btn.id)}">${btn.label}</button>` : '');
  msgTimer = setTimeout(() => { e.hidden = true; }, btn ? 9000 : 5000);
}

/* ---------- Отметка ---------- */
async function act(id) {
  const rec = D[key(id)];
  if (!rec) { buzz([80, 60, 80]); msg('warn', `Билет №${esc(id)} не найден`, { act: 'addmark', id, label: 'Добавить и впустить' }); return false; }
  if (rec.e) { buzz([120, 80, 120, 80, 120]); msg('bad', `⚠ Билет №${esc(id)} уже заходил в ${tm(rec.e)}${rec.g ? ' (' + esc(rec.g) + ')' : ''}`); return false; }
  const res = await store.mark(id, gate).catch(() => null);
  if (!res) { status('Не удалось сохранить. Проверьте правила базы.', 'bad'); return false; }
  if (res.ok) { buzz(60); msg('ok', `✓ Билет №${esc(id)} — вход отмечен`); return true; }
  buzz([120, 80, 120, 80, 120]);
  const r = res.rec || {};
  msg('bad', `⚠ Билет №${esc(id)} только что отметили${r.e ? ' в ' + tm(r.e) : ''}${r.g ? ' (' + esc(r.g) + ')' : ''}`);
  return false;
}

/* ---------- Список ---------- */
function matches() {
  const q = $('q').value.trim().toLowerCase();
  let a = all();
  if (filter === 'in') a = a.filter(t => t.e);
  if (filter === 'out') a = a.filter(t => !t.e);
  if (fac) a = a.filter(t => t.f === fac);
  if (q) {
    a = a.filter(t => t.id.toLowerCase().startsWith(q) || t.n.toLowerCase().includes(q) || t.f.toLowerCase().includes(q));
    a.sort((x, y) => (y.id.toLowerCase() === q) - (x.id.toLowerCase() === q));
  }
  return a;
}

function render() {
  const a = all(), tot = a.length, ent = a.filter(t => t.e).length;
  $('cin').textContent = ent; $('ctot').textContent = tot; $('cleft').textContent = tot - ent;
  $('pb').style.width = (tot ? ent / tot * 100 : 0) + '%';
  const by = {}; a.forEach(t => { const f = t.f || 'Без института'; (by[f] ??= [0, 0])[1]++; if (t.e) by[f][0]++; });
  const order = RANGES.map(r => r[2]).filter(f => by[f]).concat(by['Без института'] ? ['Без института'] : []);
  $('by').innerHTML = order.map(f => `<span class="chip${by[f][0] === by[f][1] ? ' full' : ''}">${esc(f)} <b>${by[f][0]}/${by[f][1]}</b></span>`).join('');
  const q = $('q').value.trim().toLowerCase(), m = matches(), shown = m.slice(0, 300);
  $('list').innerHTML = shown.map((t, i) => {
    const top = q && t.id.toLowerCase() === q && i === 0;
    const sub = [t.f, t.e ? 'зашёл ' + tm(t.e) + (t.g ? ' · ' + t.g : '') : ''].filter(Boolean).join(' · ');
    return `<div class="r${t.e ? ' in' : ''}${top ? ' top' : ''}"><b>${esc(t.id)}</b>` +
      `<span class="nm">${t.n ? esc(t.n) : ''}<small>${esc(sub)}</small></span>` +
      `<button class="${t.e ? 'u' : 'g'}" data-act="${t.e ? 'undo' : 'mark'}" data-id="${esc(t.id)}">${t.e ? 'Отменить' : 'Впустить'}</button></div>`;
  }).join('') + (m.length > 300 ? `<div class="note">Показано 300 из ${m.length}. Уточните поиск.</div>` : '')
    + (!tot ? '<div class="note">Билетов пока нет.<br><button class="btn" data-act="seed">Создать билеты 1–327 по институтам</button></div>'
            : !m.length ? '<div class="note">Ничего не найдено</div>' : '');
}

async function seed() {
  const items = []; for (let i = 1; i <= RANGES[RANGES.length - 1][1]; i++) items.push({ id: String(i), f: facOf(i) });
  await run(store.add(items)); msg('ok', `Создано билетов: ${items.length}`);
}

/* ---------- События ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id, a = b.dataset.act;
  if (a === 'mark') { await act(id); }
  else if (a === 'undo') { if (confirm(`Отменить вход для билета №${id}?`)) { await run(store.unmark(id)); msg('warn', `Отметка с билета №${esc(id)} снята`); } }
  else if (a === 'addmark') { await run(store.add([{ id, f: facOf(+id) }])); await act(id); }
  else if (a === 'seed') { await seed(); }
});
$('q').addEventListener('input', render);
$('q').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim(); if (!q) return;
  const m = matches();
  const target = D[key(q)] ? q : (m.length === 1 ? m[0].id : null);
  if (target) { await act(target); $('q').value = ''; render(); }
  else if (!m.length) { msg('warn', `Билет №${esc(q)} не найден`, { act: 'addmark', id: q, label: 'Добавить и впустить' }); }
});
$('clr').onclick = () => { $('q').value = ''; render(); $('q').focus(); };
$('tabs').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.f; [...$('tabs').children].forEach(x => x.classList.toggle('on', x === b)); render();
};
$('gate').value = gate;
$('gate').oninput = e => { gate = e.target.value.trim(); try { localStorage.setItem('gate', gate); } catch {} };

$('gen').onclick = async () => {
  const f = parseInt($('from').value, 10), t = parseInt($('to').value, 10);
  if (!(f >= 0) || !(t >= f) || t - f > 5000) { msg('bad', 'Проверьте диапазон номеров'); return; }
  const items = []; for (let i = f; i <= t; i++) items.push({ id: String(i), f: facOf(i) });
  await run(store.add(items)); msg('ok', `Создано билетов: ${items.length}`);
};
$('impb').onclick = async () => {
  const items = $('imp').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const p = l.split(/[;\t,]/); return { id: p[0].trim(), name: p.slice(1).join(' ').trim(), f: facOf(+p[0]) };
  }).filter(x => x.id);
  if (!items.length) { msg('bad', 'Список пуст'); return; }
  await run(store.add(items)); $('imp').value = ''; msg('ok', `Добавлено из списка: ${items.length}`);
};
$('csv').onclick = () => {
  const rows = [['Номер', 'Институт', 'Имя', 'Зашёл', 'Время', 'Вход']].concat(all().map(t => [t.id, t.f, t.n, t.e ? 'да' : 'нет', t.e ? new Date(t.e).toLocaleString('ru') : '', t.g]));
  const csv = '\ufeff' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'bilety.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('rst').onclick = async () => {
  if (!confirm('Сбросить ВСЕ отметки о входе?')) return;
  await run(store.reset(all().map(t => t.id))); msg('warn', 'Все отметки сброшены');
};
$('clear').onclick = async () => {
  if (!confirm('Удалить ВСЕ билеты? Это нельзя отменить.')) return;
  if (!confirm('Точно удалить все билеты?')) return;
  await run(store.clear()); msg('warn', 'Все билеты удалены');
};

$('fac').innerHTML = '<option value="">Все институты</option>' + RANGES.map(r => `<option>${r[2]}</option>`).join('');
$('fac').onchange = e => { fac = e.target.value; render(); };
$('seed').onclick = seed;
$('delone').onclick = async () => {
  const id = $('delid').value.trim(); if (!id) return;
  if (!D[key(id)]) { msg('warn', `Билет №${esc(id)} не найден`); return; }
  if (!confirm(`Удалить билет №${id}?`)) return;
  await run(store.del(id)); $('delid').value = ''; msg('warn', `Билет №${esc(id)} удалён`);
};

/* ---------- Запуск ---------- */
const onData = d => { D = d || {}; render(); };
(async () => {
  render();
  try {
    if (firebaseConfig.databaseURL) {
      store = await firebaseStore();
      const t = setTimeout(() => status('Нет связи с базой. Проверьте интернет и config.js.', 'bad'), 10000);
      store.sub(d => { clearTimeout(t); onData(d); status('● Данные общие и сохраняются', 'good'); },
                () => status('Ошибка чтения базы. Проверьте правила (ветка tickets).', 'bad'));
    } else {
      store = localStore(); store.sub(onData);
      status('Локальный режим: данные только в этом браузере (заполните config.js)', 'bad');
    }
  } catch {
    store = localStore(); store.sub(onData);
    status('Не удалось подключить базу — локальный режим', 'bad');
  }
})();
