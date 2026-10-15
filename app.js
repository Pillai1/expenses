'use strict';

// Categories match the spreadsheet columns. fill = Excel header colour; icon = SF Symbols-style glyph.
const CATEGORIES = [
  { name: 'Food', fill: 'FFFFC000', icon: '<path d="M4 2.5v6.5a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V2.5M7.5 2.5v19M20 14.5v-12a5 5 0 0 0-5 5v5.5a1.5 1.5 0 0 0 1.5 1.5H20zm0 0v7"/>' },
  { name: 'Entertainment', fill: 'FF8497B0', icon: '<path d="M2.5 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2h-15a2 2 0 0 0-2 2zM14 5v2.5M14 16.5V19M14 10.7v2.6"/>' },
  { name: 'PayNow/Paylah', fill: 'FF92D050', icon: '<path d="M7.5 3.5 4 7l3.5 3.5M4 7h16M16.5 13.5 20 17l-3.5 3.5M20 17H4"/>' },
  { name: 'Transport', fill: 'FF00B0F0', icon: '<rect x="5" y="3" width="14" height="14" rx="4"/><path d="M5 10h14M9 13.6h.01M15 13.6h.01M8.5 17l-2 3.5M15.5 17l2 3.5"/>' },
  { name: 'Cab', fill: 'FFFFFF00', icon: '<path d="M10 2.5h4M6.8 6.5h10.4l2.1 5H4.7zM4.5 11.5h15a1.5 1.5 0 0 1 1.5 1.5v4.5H3V13a1.5 1.5 0 0 1 1.5-1.5zM5.5 17.5v2M18.5 17.5v2M7.5 14.5h.01M16.5 14.5h.01"/>' },
  { name: 'Phone Bill', fill: 'FFFFE699', icon: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>' },
  { name: 'Clothing/Shoe', fill: 'FFA9D18E', icon: '<path d="M20.4 3.6 16 2a4 4 0 0 1-8 0L3.6 3.6a2 2 0 0 0-1.3 2.2l.6 3.4a1 1 0 0 0 1 .8H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.1a1 1 0 0 0 1-.8l.6-3.4a2 2 0 0 0-1.3-2.2z"/>' },
  { name: 'Others', fill: 'FFF4B183', icon: '<path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7 12 12l8.7-5M12 22V12"/>' },
];
const CATEGORY_NAMES = new Set(CATEGORIES.map(c => c.name));
const CATEGORY_INDEX = Object.fromEntries(CATEGORIES.map((c, i) => [c.name, i]));
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });
const PHOTO_MAX_PX = 1600;

/* ---------- Dates ---------- */

function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayISO() { return toISO(new Date()); }
function thisYear() { return new Date().getFullYear(); }
function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function monthOf(iso) { return iso.slice(0, 7); }
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthLabel(key, opts = { month: 'long', year: 'numeric' }) {
  return parseISO(key + '-01').toLocaleDateString('en-SG', opts);
}
function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function dayLabel(iso) {
  const today = todayISO();
  const now = new Date();
  const yesterday = toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const pretty = parseISO(iso).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
  if (iso === today) return `Today · ${pretty}`;
  if (iso === yesterday) return `Yesterday · ${pretty}`;
  return pretty;
}

/* ---------- Storage (IndexedDB, on this device only) ---------- */

const db = {
  conn: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('expenses-app', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('expenses', { keyPath: 'id' });
        req.result.createObjectStore('photos');
      };
      req.onsuccess = () => { this.conn = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.conn.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  all(store) { return this.run(store, 'readonly', s => s.getAll()); },
  get(store, key) { return this.run(store, 'readonly', s => s.get(key)); },
  put(store, value, key) { return this.run(store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key))); },
  del(store, key) { return this.run(store, 'readwrite', s => s.delete(key)); },
  // records: [{ expense, photo: Blob | null }], written in one transaction.
  addAll(records) {
    return new Promise((resolve, reject) => {
      const tx = this.conn.transaction(['expenses', 'photos'], 'readwrite');
      const expenses = tx.objectStore('expenses');
      const photos = tx.objectStore('photos');
      for (const r of records) {
        expenses.put(r.expense);
        if (r.photo) photos.put(r.photo, r.expense.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};

/* ---------- State ---------- */

const HIDE_KEY = 'expenses-hide-amounts';
function readHidden() {
  try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}

const state = {
  expenses: [],
  tab: 'list',                // 'list' (Expenses) or 'dash' (Dashboard)
  month: monthOf(todayISO()), // month shown on the Expenses tab
  year: thisYear(),           // year shown on the Dashboard
  dashMonth: null,            // month picked in the Dashboard chart
  catScope: 'month',          // Dashboard category breakdown: 'month' or 'year'
  detail: null,               // { category, key: 'YYYY' | 'YYYY-MM' } while a category page is pushed on the Dashboard
  editing: null,              // expense being edited, or null for a new one
  category: null,             // selected category in the sheet
  draftPhoto: undefined,      // undefined = unchanged, null = removed, Blob = new photo
  sign: 1,                    // 1 = spent, -1 = received (paybacks, refunds) in the sheet
  hidden: readHidden(),       // amounts masked with asterisks
  thumbUrl: null,
};

const $ = id => document.getElementById(id);
const els = {
  navbar: $('navbar'), navTitle: $('navTitle'), backBtn: $('backBtn'), hideBtn: $('hideBtn'), menuBtn: $('menuBtn'),
  title: $('title'), period: $('period'), monthLabel: $('monthLabel'), prevMonth: $('prevMonth'), nextMonth: $('nextMonth'),
  list: $('view-list'), dash: $('view-dash'), detailView: $('view-detail'), addBtn: $('addBtn'),
  sheet: $('sheet'), sheetForm: $('sheetForm'), sheetTitle: $('sheetTitle'), cancelBtn: $('cancelBtn'),
  amount: $('amount'), amountWrap: $('amountWrap'), amountError: $('amountError'), currency: $('currency'), signSeg: $('signSeg'),
  chips: $('chips'), categoryError: $('categoryError'), date: $('date'), note: $('note'),
  photoAdd: $('photoAdd'), photoInput: $('photoInput'), photoPreview: $('photoPreview'),
  photoThumb: $('photoThumb'), thumbBtn: $('thumbBtn'), photoRemove: $('photoRemove'), deleteBtn: $('deleteBtn'),
  menu: $('menu'), menuBody: $('menuBody'), restoreInput: $('restoreInput'),
  viewer: $('viewer'), viewerImg: $('viewerImg'), viewerClose: $('viewerClose'), toast: $('toast'),
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sumCents(list) { return list.reduce((n, e) => n + e.cents, 0); }
// With "hide amounts" on, every amount on screen shows as $**** (exports and backups are unaffected).
function fmt(cents) { return state.hidden ? '$****' : money.format(cents / 100); }
function newestFirst(a, b) { return b.date.localeCompare(a.date) || b.createdAt - a.createdAt; }
function oldestFirst(a, b) { return a.date.localeCompare(b.date) || a.createdAt - b.createdAt; }
function inMonth(key) { return state.expenses.filter(e => monthOf(e.date) === key); }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

// Expenses saved under the app's earlier category list move to Others, keeping the old name as the description.
function normalizeCategory(e) {
  if (CATEGORY_NAMES.has(e.category)) return e;
  return { ...e, category: 'Others', note: e.note || e.category };
}

/* ---------- Symbols ---------- */

const svg = (body, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${body}</svg>`;
const ICON = {
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  chevron: svg('<path d="M9 5l7 7-7 7"/>', 'chev'),
  camera: svg('<path d="M3.5 8.5a2 2 0 0 1 2-2h2l1.6-2.2h5.8l1.6 2.2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/>'),
  tray: svg('<path d="M3 13.5 5.6 5a2 2 0 0 1 1.9-1.4h9a2 2 0 0 1 1.9 1.4l2.6 8.5v4.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>'),
  check: svg('<circle cx="12" cy="12" r="9.5"/><path d="M8 12.3l2.7 2.7L16.2 9.5"/>'),
  alert: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.5h.01"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M3 14.75h18M9.5 9.5V20"/>'),
  archive: svg('<rect x="2.5" y="3.5" width="19" height="5" rx="1.5"/><path d="M4.5 8.5v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-10M10 12.5h4"/>'),
  restore: svg('<path d="M3.5 4v5.5H9"/><path d="M4 9.5a8.5 8.5 0 1 1-.5 5"/><path d="M12 8v4.5l3 2"/>'),
};

// White category symbol on the category's system colour.
function badge(category, cls = '') {
  const i = CATEGORY_INDEX[category] ?? CATEGORIES.length - 1;
  return `<span class="badge k${i}${cls ? ' ' + cls : ''}" aria-hidden="true">${svg(CATEGORIES[i].icon)}</span>`;
}

/* ---------- Rendering ---------- */

function render() {
  const isList = state.tab === 'list';
  const inDetail = !isList && !!state.detail;
  const title = isList ? 'Expenses' : inDetail ? state.detail.category : 'Dashboard';
  els.title.innerHTML = inDetail ? `${badge(title, 'lg')}<span>${esc(title)}</span>` : esc(title);
  els.navTitle.textContent = title;
  els.backBtn.hidden = !inDetail;
  els.period.hidden = inDetail;
  els.monthLabel.textContent = isList ? monthLabel(state.month) : String(state.year);
  els.nextMonth.disabled = isList ? state.month >= monthOf(todayISO()) : state.year >= thisYear();
  els.prevMonth.setAttribute('aria-label', isList ? 'Previous month' : 'Previous year');
  els.nextMonth.setAttribute('aria-label', isList ? 'Next month' : 'Next year');
  els.monthLabel.setAttribute('aria-label', isList ? 'Jump to this month' : 'Jump to this year');
  els.list.hidden = !isList;
  els.dash.hidden = isList || inDetail;
  els.detailView.hidden = !inDetail;
  els.hideBtn.innerHTML = state.hidden ? ICON.eyeOff : ICON.eye;
  els.hideBtn.setAttribute('aria-pressed', String(state.hidden));
  els.hideBtn.setAttribute('aria-label', state.hidden ? 'Show amounts' : 'Hide amounts');
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.tab === state.tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (isList) renderList(); else if (inDetail) renderDetail(); else renderDashboard();
  updateNavbar();
}

function heroHtml(label, cents, sub) {
  return `<div class="hero">
    <div class="hero-label">${esc(label)}</div>
    <div class="hero-value">${fmt(cents)}</div>
    <div class="hero-sub">${esc(sub)}</div>
  </div>`;
}

function emptyHtml(title, message) {
  return `<div class="empty">${ICON.tray}<h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
}

function expenseRow(e) {
  const sub = [e.note ? esc(e.category) : '', e.cents < 0 ? 'Received' : ''].filter(Boolean).join(' · ');
  return `<button class="row item" data-id="${esc(e.id)}">
    ${badge(e.category)}
    <span class="row-main">
      <span class="row-title">${esc(e.note || e.category)}</span>
      ${sub || e.hasPhoto ? `<span class="row-sub">${sub}${e.hasPhoto ? ICON.camera : ''}</span>` : ''}
    </span>
    <span class="row-amount${e.cents < 0 ? ' received' : ''}">${fmt(e.cents)}</span>
  </button>`;
}

function dayGroupsHtml(items) {
  const days = new Map();
  for (const e of items) {
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
  }
  let html = '';
  for (const [date, list] of days) {
    html += `<section class="group">
      <h3 class="group-head"><span>${esc(dayLabel(date))}</span><span>${fmt(sumCents(list))}</span></h3>
      <div class="card">${list.map(expenseRow).join('')}</div>
    </section>`;
  }
  return html;
}

function renderList() {
  const items = inMonth(state.month).sort(newestFirst);
  const monthName = monthLabel(state.month, { month: 'long' });
  els.list.innerHTML = heroHtml(`Spent in ${monthName}`, sumCents(items), plural(items.length, 'expense')) +
    (items.length ? dayGroupsHtml(items) : emptyHtml('No Expenses', `Tap + to add one for ${monthName}.`));
}

// Net per category (money received reduces it). Spending categories get a bar; net-received ones are listed last.
function categoryRows(items) {
  const byCat = new Map();
  for (const e of items) byCat.set(e.category, (byCat.get(e.category) || 0) + e.cents);
  const rows = [...byCat].filter(([, c]) => c !== 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="inline-empty">Nothing spent yet</p>';
  const spent = rows.reduce((n, [, c]) => n + Math.max(c, 0), 0);
  const max = Math.max(rows[0][1], 1);
  return rows.map(([cat, cents]) => {
    const pct = cents <= 0 ? '' : cents / spent < 0.005 ? '<1%' : `${Math.round((cents / spent) * 100)}%`;
    return `<button class="row cat-row" data-cat="${esc(cat)}">
      ${badge(cat)}
      <span class="row-main">
        <span class="row-line">
          <span class="row-title">${esc(cat)}</span>
          <span class="row-meta">${pct}</span>
          <span class="row-amount${cents < 0 ? ' received' : ''}">${fmt(cents)}</span>
        </span>
        ${cents > 0 ? `<span class="meter"><span style="width:${(cents / max) * 100}%"></span></span>` : ''}
      </span>
      ${ICON.chevron}
    </button>`;
  }).join('');
}

function renderDashboard() {
  const year = state.year;
  const now = monthOf(todayISO());
  const isThisYear = year === thisYear();
  const months = MONTH_SHORT.map((_, i) => `${year}-${pad(i + 1)}`);
  const totals = months.map(m => sumCents(inMonth(m)));
  const yearItems = state.expenses.filter(e => e.date.startsWith(`${year}-`));
  const total = sumCents(yearItems);
  const monthsSoFar = isThisYear ? Number(now.slice(5)) : 12;
  if (!state.dashMonth || !state.dashMonth.startsWith(`${year}-`)) state.dashMonth = isThisYear ? now : `${year}-12`;

  const sel = state.dashMonth;
  const selIndex = Number(sel.slice(5)) - 1;
  const selTotal = totals[selIndex];
  const prev = shiftMonth(sel, -1);
  const prevTotal = sumCents(inMonth(prev));
  let change = '';
  if (selTotal && prevTotal) {
    const pct = Math.round(((selTotal - prevTotal) / prevTotal) * 100);
    const prevName = MONTH_SHORT[Number(prev.slice(5)) - 1];
    change = pct === 0 ? `Same as ${prevName}` : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs ${prevName}`;
  }

  let html = heroHtml(`Spent in ${year}`, total, total ? `Avg ${fmt(Math.round(total / monthsSoFar))} a month` : 'No expenses yet');

  const peak = Math.max(...totals, 1); // a month can't show below zero, even if more came in than went out
  html += `<section class="card chart-card">
    <div class="chart-head"><span class="chart-title">${esc(monthLabel(sel, { month: 'long' }))}</span><span class="chart-value">${fmt(selTotal)}</span></div>
    <div class="chart-sub">${change ? esc(change) : '&nbsp;'}</div>
    <div class="months">${months.map((m, i) => `<button class="month-col" data-month="${m}" aria-label="${esc(`${monthLabel(m)}: ${fmt(totals[i])}`)}"${m === sel ? ' aria-current="true"' : ''}>
        <span class="month-track"><span class="month-bar" style="height:${totals[i] > 0 ? Math.max((totals[i] / peak) * 100, 3) : 0}%"></span></span>
        <span class="month-name">${MONTH_SHORT[i]}</span>
      </button>`).join('')}</div>
  </section>`;

  const byYear = state.catScope === 'year';
  html += `<div class="section-row">
    <h2 class="section-title">By Category</h2>
    <div class="seg" role="group" aria-label="Show categories for">
      <button data-scope="month" aria-pressed="${!byYear}">${MONTH_SHORT[selIndex]}</button>
      <button data-scope="year" aria-pressed="${byYear}">${year}</button>
    </div>
  </div>
  <div class="card">${categoryRows(byYear ? yearItems : inMonth(sel))}</div>`;
  els.dash.innerHTML = html;
}

// Pushed page for one category: where the money went, then every expense in it.
function renderDetail() {
  const { category, key } = state.detail;
  const items = state.expenses.filter(e => e.category === category && e.date.startsWith(`${key}-`)).sort(newestFirst);
  let html = heroHtml(key.length === 4 ? key : monthLabel(key), sumCents(items), plural(items.length, 'expense'));

  const places = new Map();
  for (const e of items) {
    const name = e.note || category;
    const k = name.toLowerCase();
    const place = places.get(k) || { name, cents: 0, count: 0 };
    place.cents += e.cents;
    place.count += 1;
    places.set(k, place);
  }
  const ranked = [...places.values()].sort((a, b) => b.cents - a.cents);
  if (ranked.length > 1) {
    const rest = ranked.slice(10);
    const shown = rest.length
      ? [...ranked.slice(0, 10), { name: `${rest.length} more`, cents: sumCents(rest), count: rest.reduce((c, p) => c + p.count, 0) }]
      : ranked;
    html += `<div class="section-row"><h2 class="section-title">Where It Went</h2></div>
      <div class="card group">${shown.map(p => `<div class="row place-row">
        <span class="row-title">${esc(p.name)}</span>
        <span class="row-meta">${p.count}×</span>
        <span class="row-amount${p.cents < 0 ? ' received' : ''}">${fmt(p.cents)}</span>
      </div>`).join('')}</div>`;
  }
  html += items.length
    ? `<div class="section-row"><h2 class="section-title">All Expenses</h2></div>${dayGroupsHtml(items)}`
    : emptyHtml('Nothing Here', 'No expenses in this category for this period.');
  els.detailView.innerHTML = html;
}

/* ---------- Navigation ---------- */

function animateView(el, cls) {
  el.classList.remove('push', 'pop');
  void el.offsetWidth;
  if (cls) el.classList.add(cls);
}

// Tabs keep their own place; tapping the current tab again goes back to its top level.
function showTab(tab) {
  if (tab === state.tab && tab === 'dash' && state.detail) { closeDetail(); return; }
  state.tab = tab;
  render();
  animateView(tab === 'list' ? els.list : state.detail ? els.detailView : els.dash);
  window.scrollTo(0, 0);
}

function openDetail(category) {
  state.detail = { category, key: state.catScope === 'year' ? String(state.year) : state.dashMonth };
  render();
  animateView(els.detailView, 'push');
  window.scrollTo(0, 0);
}

function closeDetail() {
  state.detail = null;
  render();
  animateView(els.dash, 'pop');
  window.scrollTo(0, 0);
}

// The header arrows move the month on the Expenses tab and the year on the Dashboard.
function shiftPeriod(delta) {
  if (state.tab === 'list') state.month = shiftMonth(state.month, delta);
  else state.year += delta;
  render();
}

function resetPeriod() {
  state.month = monthOf(todayISO());
  state.year = thisYear();
  render();
}

function toggleHidden() {
  state.hidden = !state.hidden;
  try { localStorage.setItem(HIDE_KEY, state.hidden ? '1' : '0'); } catch {}
  render();
}

// Scroll edge effect + inline title once the large title has scrolled under the bar.
function updateNavbar() {
  const y = window.scrollY;
  const titleBottom = els.title.offsetTop + els.title.offsetHeight - els.navbar.offsetHeight;
  els.navbar.classList.toggle('scrolled', y > 4);
  els.navbar.classList.toggle('show-title', y > titleBottom);
}

/* ---------- Add / edit sheet ---------- */

// Plays the dialog's closing animation, then closes it (straight away with Reduce Motion).
function closeDialog(dlg) {
  if (!dlg.open || dlg.classList.contains('closing')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { dlg.close(); return; }
  const finish = () => {
    clearTimeout(timer);
    dlg.removeEventListener('animationend', onEnd);
    dlg.classList.remove('closing');
    if (dlg.open) dlg.close();
  };
  const onEnd = e => { if (e.target === dlg) finish(); };
  const timer = setTimeout(finish, 450);
  dlg.addEventListener('animationend', onEnd);
  dlg.classList.add('closing');
}

function setSign(sign) {
  state.sign = sign;
  els.signSeg.querySelectorAll('[data-sign]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.sign) === sign)));
  els.currency.textContent = sign < 0 ? '−$' : '$';
  els.amountWrap.classList.toggle('received', sign < 0);
}

function renderChips() {
  els.chips.innerHTML = CATEGORIES.map(c =>
    `<button type="button" class="cat" role="radio" data-cat="${esc(c.name)}" aria-checked="${c.name === state.category}">
      ${badge(c.name)}<span class="cat-name">${esc(c.name)}</span>
    </button>`
  ).join('');
}

function setThumb(blob) {
  if (state.thumbUrl) URL.revokeObjectURL(state.thumbUrl);
  state.thumbUrl = blob ? URL.createObjectURL(blob) : null;
  els.photoThumb.src = state.thumbUrl || '';
  els.photoPreview.hidden = !blob;
  els.photoAdd.hidden = !!blob;
}

function openSheet(expense) {
  state.editing = expense || null;
  state.category = expense ? expense.category : null;
  state.draftPhoto = undefined;
  els.sheetTitle.textContent = expense ? 'Edit Expense' : 'New Expense';
  els.amount.value = expense ? (Math.abs(expense.cents) / 100).toFixed(2) : '';
  setSign(expense && expense.cents < 0 ? -1 : 1);
  sizeAmount();
  els.date.value = expense ? expense.date : todayISO();
  els.note.value = expense ? expense.note : '';
  els.amountError.hidden = true;
  els.categoryError.hidden = true;
  els.deleteBtn.hidden = !expense;
  els.deleteBtn.classList.remove('confirm');
  els.deleteBtn.textContent = 'Delete Expense';
  renderChips();
  setThumb(null);
  if (expense && expense.hasPhoto) {
    db.get('photos', expense.id).then(blob => { if (state.editing === expense && blob) setThumb(blob); });
  }
  document.body.classList.add('locked');
  els.sheet.showModal();
  if (!expense) els.amount.focus();
  else els.sheetForm.querySelector('.sheet-body').scrollTop = 0;
}

function closeSheet() {
  closeDialog(els.sheet);
}

// Grow the big amount field with its contents so the "$" stays snug against the number.
function sizeAmount() {
  els.amount.style.width = `${Math.max(4.5, els.amount.value.length + 0.6)}ch`;
}

function parseAmount(text) {
  const clean = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const parts = clean.split('.');
  const value = parseFloat(parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : clean);
  if (!isFinite(value) || value <= 0 || value >= 1e9) return 0;
  return Math.round(value * 100);
}

function flag(el, errorEl) {
  errorEl.hidden = false;
  el.classList.remove('invalid');
  void el.offsetWidth; // restart the shake animation
  el.classList.add('invalid');
}

async function saveSheet() {
  const cents = parseAmount(els.amount.value) * state.sign;
  els.amountError.hidden = !!cents;
  els.categoryError.hidden = !!state.category;
  if (!cents) { flag(els.amountWrap, els.amountError); els.amount.focus(); return; }
  if (!state.category) { flag(els.chips, els.categoryError); return; }

  const isEdit = !!state.editing;
  const base = state.editing || { id: newId(), createdAt: Date.now(), hasPhoto: false };
  const expense = {
    ...base,
    cents,
    category: state.category,
    date: els.date.value || todayISO(),
    note: els.note.value.trim(),
  };
  try {
    if (state.draftPhoto instanceof Blob) {
      await db.put('photos', state.draftPhoto, expense.id);
      expense.hasPhoto = true;
    } else if (state.draftPhoto === null) {
      await db.del('photos', expense.id);
      expense.hasPhoto = false;
    }
    await db.put('expenses', expense);
  } catch (err) {
    console.error(err);
    toast('Could not save — storage error', 'error');
    return;
  }
  const i = state.expenses.findIndex(e => e.id === expense.id);
  if (i >= 0) state.expenses[i] = expense; else state.expenses.push(expense);
  if (state.tab === 'list') state.month = monthOf(expense.date);
  closeSheet();
  render();
  toast(isEdit ? 'Updated' : 'Saved');
}

let deleteTimer = 0;
async function deleteExpense() {
  const btn = els.deleteBtn;
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.textContent = 'Tap Again to Delete';
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = 'Delete Expense'; }, 3000);
    return;
  }
  clearTimeout(deleteTimer);
  const { id } = state.editing;
  try {
    await db.del('expenses', id);
    await db.del('photos', id);
  } catch (err) {
    console.error(err);
    toast('Could not delete — storage error', 'error');
    return;
  }
  state.expenses = state.expenses.filter(e => e.id !== id);
  closeSheet();
  render();
  toast('Deleted');
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Shrink camera photos so hundreds of receipts fit comfortably in on-device storage.
async function compressPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, PHOTO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    return blob || file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- Excel export: same layout as the 2026_Expenses spreadsheet ---------- */

const XL_MONEY = '"$"#,##0.00';
const XL_INK = 'FF3F3F3F';
const XL_GREY = 'FFF2F2F2';
const XL_THIN = { left: 'thin', right: 'thin', top: 'thin', bottom: 'thin' };
const XL_CELL = { font: { b: true, color: XL_INK }, fill: XL_GREY, border: { ...XL_THIN, color: XL_INK } };
const XL_TOTAL = { font: { b: true }, fill: XL_GREY, border: { left: 'thin', right: 'thin', bottom: 'double' }, numFmt: XL_MONEY };
const XL_INPUT = { font: { color: 'FF3F3F76' }, fill: 'FFFFCC99', border: { ...XL_THIN, color: 'FF7F7F7F' } };
const XL = {
  title: { ...XL_CELL, font: { b: true, sz: 16, color: XL_INK }, align: { h: 'center' } },
  yearTitle: { ...XL_CELL, font: { b: true, sz: 16, color: XL_INK }, fill: 'FFFFFF00', border: XL_THIN, align: { h: 'center' } },
  yearHead: { ...XL_CELL, border: { left: 'thin', right: 'thin', bottom: 'thin', color: XL_INK }, align: { h: 'center' } },
  center: { ...XL_CELL, align: { h: 'center' } },
  left: { ...XL_CELL, align: { h: 'left' } },
  date: { ...XL_CELL, numFmt: 14 },
  money: { ...XL_CELL, numFmt: XL_MONEY },
  cell: { ...XL_CELL, numFmt: XL_MONEY, align: { h: 'right' } },
  cellWrap: { ...XL_CELL, numFmt: XL_MONEY, align: { h: 'right', wrap: true } },
  // The last day of the month has a double line underneath, above the Total row.
  cellLast: { ...XL_CELL, border: { ...XL_THIN, bottom: 'double', color: XL_INK }, numFmt: XL_MONEY, align: { h: 'right' } },
  cellWrapLast: { ...XL_CELL, border: { ...XL_THIN, bottom: 'double', color: XL_INK }, numFmt: XL_MONEY, align: { h: 'right', wrap: true } },
  totalLabel: { ...XL_CELL, border: { left: 'thin', top: 'thin', bottom: 'thin', color: XL_INK } },
  total: XL_TOTAL,
  totalNil: { ...XL_TOTAL, align: { h: 'right' } },
  inputLabel: XL_INPUT,
  inputMoney: { ...XL_INPUT, numFmt: XL_MONEY },
};
// Column widths from the original sheet; amount columns widened a little so larger sums don't show as ####.
const XL_MONTH_WIDTHS = [10.3, 9, 14.3, 14, 11.2, 15.2, 22.3, 9.5, 12.5, 9, 11.2, 10, 11.2, 13.8, 11.2, 9, 34.7, null, null, 12];

// One sheet per month: a row per day, an amount + description column per category, then totals.
function monthSheet(year, monthIndex) {
  const key = `${year}-${pad(monthIndex + 1)}`;
  const days = daysInMonth(key);
  const totalRow = days + 3;
  const groups = new Map();
  for (const e of inMonth(key).sort(oldestFirst)) {
    const k = `${e.date}|${e.category}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  const rows = [
    [{ v: 'Daily expenses', s: XL.title }, ...Array(CATEGORIES.length * 2).fill({ s: XL.title })],
    [{ v: 'Days', s: XL.center }, ...CATEGORIES.flatMap(c => [
      { v: c.name, s: { ...XL_CELL, fill: c.fill, align: { h: 'center' } } },
      { v: 'Description', s: { ...XL_CELL, fill: c.fill, numFmt: XL_MONEY, align: { h: 'right' } } },
    ])],
  ];
  const heights = { 1: 21 };
  const catTotals = CATEGORIES.map(() => 0);

  for (let d = 1; d <= days; d++) {
    const iso = `${key}-${pad(d)}`;
    const row = [{ v: XLSXWriter.dateSerial(iso), s: XL.date }];
    const last = d === days;
    const plain = last ? XL.cellLast : XL.cell;
    const wrap = last ? XL.cellWrapLast : XL.cellWrap;
    let lines = 1;
    CATEGORIES.forEach((c, ci) => {
      const list = groups.get(`${iso}|${c.name}`);
      if (!list) { row.push({ v: '-', s: plain }, { v: '-', s: plain }); return; }
      const cents = sumCents(list);
      catTotals[ci] += cents;
      // Several items on one day become "=5.3+10.2" with one description per line, like the original sheet.
      const amount = list.length === 1
        ? { v: cents / 100, s: plain }
        : { f: list.map((e, i) => (i && e.cents > 0 ? '+' : '') + e.cents / 100).join(''), v: cents / 100, s: plain };
      // One line per place: two Grab rides show "Grab" once, matching how the sheet was kept by hand.
      const descLines = [...new Set(list.map(e => e.note || c.name))];
      lines = Math.max(lines, descLines.length);
      row.push(amount, { v: descLines.join('\n'), s: descLines.length > 1 ? wrap : plain });
    });
    if (lines > 1) heights[d + 2] = 16 * lines;
    rows.push(row);
  }

  rows.push([{ v: 'Total', s: XL.totalLabel }, ...CATEGORIES.flatMap((c, ci) => {
    const col = XLSXWriter.colName(1 + ci * 2);
    return [{ f: `SUM(${col}3:${col}${totalRow - 1})`, v: catTotals[ci] / 100, s: XL.total }, { v: 'Nil', s: XL.totalNil }];
  })]);

  // The month's grand total sits in T15, which the Summary sheet reads.
  const amountRefs = CATEGORIES.map((c, ci) => `${XLSXWriter.colName(1 + ci * 2)}${totalRow}`).join(',');
  rows[14].push(null, { v: 'Total', s: XL.inputLabel }, { f: `SUM(${amountRefs})`, v: catTotals.reduce((a, b) => a + b, 0) / 100, s: XL.inputMoney });

  return {
    name: MONTH_SHORT[monthIndex], rows, heights, widths: XL_MONTH_WIDTHS,
    merges: [`A1:${XLSXWriter.colName(CATEGORIES.length * 2)}1`],
    todayHighlight: { range: `A3:A${totalRow - 1}`, fill: 'FFFFFF00' },
  };
}

function summarySheet(year) {
  const totals = MONTH_SHORT.map((_, i) => sumCents(inMonth(`${year}-${pad(i + 1)}`)));
  const yearly = totals.reduce((a, b) => a + b, 0);
  const now = new Date();
  const asOf = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  return {
    name: 'Summary',
    rows: [
      [{ v: 'Expenses summary', s: XL.yearTitle }, ...Array(14).fill({ s: XL.yearTitle })],
      [{ v: year, s: XL.yearHead }, ...MONTH_SHORT.map(m => ({ v: m, s: XL.yearHead })), { v: 'Yearly', s: XL.yearHead }, { v: 'Average', s: XL.yearHead }],
      [
        { v: 'Actual amount spent', s: XL.left },
        ...MONTH_SHORT.map((m, i) => ({ f: `${m}!T15`, v: totals[i] / 100, s: XL.money })),
        { f: 'SUM(B3:M3)', v: yearly / 100, s: XL.money },
        { f: 'N3/12', v: yearly / 1200, s: XL.money },
      ],
      [{ v: `As of ${asOf}`, s: XL.center }, ...Array(14).fill({ s: XL.center })],
    ],
    widths: [19.8, 11.5, 14.3, 14, 13.5, 15.2, 21.7, 13.5, 13.5, 11, 11, 11, 11, 13.8, 12.8],
    heights: { 1: 21 },
    merges: ['A1:O1', 'A4:O4'],
    zoom: 115,
  };
}

function buildYearWorkbook(year) {
  return XLSXWriter.build([summarySheet(year), ...MONTH_SHORT.map((_, i) => monthSheet(year, i))]);
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// iOS: the Share sheet offers "Save to Files", Mail, WhatsApp, Excel, etc.
// Returns 'done', 'cancelled', or 'blocked' when iOS wants a fresh tap before sharing.
async function saveFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'done';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      if (err.name === 'NotAllowedError') return 'blocked';
      console.warn('Share failed, falling back to download', err);
    }
  }
  downloadFile(file);
  return 'done';
}

async function exportExcel(year) {
  const file = new File([buildYearWorkbook(Number(year))], `${year}_Expenses.xlsx`, { type: XLSXWriter.MIME });
  if (await saveFile(file) === 'blocked') downloadFile(file);
}

/* ---------- Backup & restore ---------- */

// A backup is a zip: backup.json (all expenses) + receipts/*.jpg (the photos, viewable in the Files app).
const BACKUP_KIND = 'expenses-backup';
const LAST_BACKUP_KEY = 'expenses-last-backup';
const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' };
let preparedBackup = null;

function readLastBackup() {
  try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; }
}

async function buildBackup() {
  const files = [];
  const entries = [];
  for (const e of [...state.expenses].sort(oldestFirst)) {
    const entry = { id: e.id, date: e.date, cents: e.cents, category: e.category, note: e.note, createdAt: e.createdAt };
    const blob = e.hasPhoto ? await db.get('photos', e.id) : null;
    if (blob) {
      const type = blob.type || 'image/jpeg';
      entry.photo = `receipts/${e.date} ${e.category} ${(e.cents / 100).toFixed(2)} ${e.id}.${PHOTO_EXT[type] || 'jpg'}`;
      entry.photoType = type;
      files.push({ name: entry.photo, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    entries.push(entry);
  }
  const manifest = { kind: BACKUP_KIND, version: 1, createdAt: new Date().toISOString(), currency: 'SGD', expenses: entries };
  files.unshift({ name: 'backup.json', data: JSON.stringify(manifest, null, 1) });
  return new File([Zip.zip(files)], `Expenses-backup-${todayISO()}.zip`, { type: 'application/zip' });
}

function isBackupEntry(x) {
  return x && typeof x.id === 'string' && x.id &&
    typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
    Number.isInteger(x.cents) && x.cents !== 0 &&
    typeof x.category === 'string' && x.category;
}

// Adds what's missing from the backup; never changes or removes expenses already in the app.
async function restoreBackup(file) {
  let files, manifest;
  try {
    files = await Zip.unzip(new Uint8Array(await file.arrayBuffer()));
    manifest = JSON.parse(new TextDecoder().decode(files.get('backup.json')));
    if (manifest.kind !== BACKUP_KIND || !Array.isArray(manifest.expenses)) throw new Error('Not an Expenses backup');
  } catch (err) {
    console.error(err);
    toast('That file isn’t an Expenses backup', 'error');
    return;
  }
  const valid = manifest.expenses.filter(isBackupEntry);
  const have = new Set(state.expenses.map(e => e.id));
  const missing = valid.filter(x => !have.has(x.id));
  if (!missing.length) { toast('Everything in this backup is already here'); return; }

  const when = new Date(manifest.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
  const kept = valid.length - missing.length;
  const question = `Restore the backup from ${when}?\n\n${missing.length} expense${missing.length === 1 ? '' : 's'} will be added.` +
    (kept ? ` ${kept} already in the app will be left as they are.` : '');
  if (!confirm(question)) return;

  const records = missing.map(x => {
    const photo = x.photo ? files.get(x.photo) : null;
    return {
      expense: normalizeCategory({
        id: x.id, date: x.date, cents: x.cents, category: x.category,
        note: typeof x.note === 'string' ? x.note : '',
        createdAt: Number(x.createdAt) || Date.now(),
        hasPhoto: !!photo,
      }),
      photo: photo ? new Blob([photo], { type: x.photoType || 'image/jpeg' }) : null,
    };
  });
  try {
    await db.addAll(records);
  } catch (err) {
    console.error(err);
    toast('Could not restore — storage error', 'error');
    return;
  }
  state.expenses.push(...records.map(r => r.expense));
  render();
  toast(`Restored ${records.length} expense${records.length === 1 ? '' : 's'}`);
}

/* ---------- Menu: export and backup ---------- */

function openMenu() {
  const counts = new Map();
  for (const e of state.expenses) {
    const y = e.date.slice(0, 4);
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  const years = [...counts.keys()].sort().reverse();
  const last = readLastBackup();
  const lastText = last
    ? `Last saved ${new Date(last).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : 'Not backed up yet';
  els.menuBody.innerHTML =
    '<div class="menu-label">Export to Excel</div>' +
    (years.length
      ? years.map(y => `<button class="menu-item" role="menuitem" data-export="${y}">
          <span class="mi-text">Export ${y}<span class="mi-sub">${plural(counts.get(y), 'expense')}</span></span>${ICON.table}
        </button>`).join('')
      : '<div class="menu-item" aria-disabled="true"><span class="mi-text">No expenses yet</span></div>') +
    `<div class="menu-sep" role="separator"></div>
    <div class="menu-label">Backup, including receipt photos</div>
    <button class="menu-item" role="menuitem" id="backupSave">
      <span class="mi-text"><span id="backupLabel">Save Backup</span><span class="mi-sub">${esc(lastText)}</span></span>${ICON.archive}
    </button>
    <label class="menu-item" role="menuitem" for="restoreInput">
      <span class="mi-text">Restore from Backup<span class="mi-sub">Adds anything that’s missing</span></span>${ICON.restore}
    </label>`;
  preparedBackup = null;
  els.menu.showModal();
}

function setBackupLabel(text, busy) {
  const btn = $('backupSave');
  if (!btn) return;
  $('backupLabel').textContent = text;
  btn.setAttribute('aria-disabled', String(!!busy));
}

async function saveBackup() {
  if (!state.expenses.length) { toast('Nothing to back up yet', 'error'); return; }
  if ($('backupSave').getAttribute('aria-disabled') === 'true') return;
  if (!preparedBackup) {
    setBackupLabel('Preparing Backup…', true);
    try {
      preparedBackup = await buildBackup();
    } catch (err) {
      console.error(err);
      closeDialog(els.menu);
      toast('Could not create backup', 'error');
      return;
    }
    if (!els.menu.open) { preparedBackup = null; return; } // dismissed while preparing
  }
  const result = await saveFile(preparedBackup);
  if (result === 'blocked') {
    // Gathering photos took long enough that iOS needs another tap to open the Share sheet.
    setBackupLabel('Backup Ready — Tap to Save', false);
    return;
  }
  preparedBackup = null;
  closeDialog(els.menu);
  if (result === 'done') {
    try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch {}
    toast('Backup saved');
  }
}

/* ---------- Toast ---------- */

let toastTimer = 0;
function toast(msg, kind = 'ok') {
  els.toast.innerHTML = `${kind === 'error' ? ICON.alert : ICON.check}<span>${esc(msg)}</span>`;
  els.toast.classList.toggle('error', kind === 'error');
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2000);
}

/* ---------- Events ---------- */

function bind() {
  els.addBtn.addEventListener('click', () => openSheet(null));
  els.menuBtn.addEventListener('click', openMenu);
  els.hideBtn.addEventListener('click', toggleHidden);
  els.backBtn.addEventListener('click', closeDetail);
  els.prevMonth.addEventListener('click', () => shiftPeriod(-1));
  els.nextMonth.addEventListener('click', () => shiftPeriod(1));
  els.monthLabel.addEventListener('click', resetPeriod);
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; updateNavbar(); });
  }, { passive: true });

  const openItem = e => {
    const item = e.target.closest('.item');
    if (item) openSheet(state.expenses.find(x => x.id === item.dataset.id));
  };
  els.list.addEventListener('click', openItem);
  els.detailView.addEventListener('click', openItem);
  els.dash.addEventListener('click', e => {
    const cat = e.target.closest('.cat-row');
    const col = e.target.closest('.month-col');
    const scope = e.target.closest('[data-scope]');
    if (cat) { openDetail(cat.dataset.cat); return; }
    if (col) state.dashMonth = col.dataset.month;
    else if (scope) state.catScope = scope.dataset.scope;
    else return;
    render();
  });

  els.signSeg.addEventListener('click', e => {
    const btn = e.target.closest('[data-sign]');
    if (btn) setSign(Number(btn.dataset.sign));
  });
  els.chips.addEventListener('click', e => {
    const chip = e.target.closest('.cat');
    if (!chip) return;
    state.category = chip.dataset.cat;
    els.categoryError.hidden = true;
    els.chips.querySelectorAll('.cat').forEach(c => c.setAttribute('aria-checked', String(c === chip)));
    if (document.activeElement === els.amount) els.amount.blur();
  });
  els.amount.addEventListener('input', () => { els.amountError.hidden = true; sizeAmount(); });
  els.amount.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); els.amount.blur(); } });
  els.note.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); els.note.blur(); } });

  els.sheetForm.addEventListener('submit', e => { e.preventDefault(); saveSheet(); });
  els.cancelBtn.addEventListener('click', closeSheet);
  els.deleteBtn.addEventListener('click', deleteExpense);
  els.sheet.addEventListener('close', () => {
    document.body.classList.remove('locked');
    setThumb(null);
    els.photoInput.value = '';
  });

  els.photoInput.addEventListener('change', async () => {
    const file = els.photoInput.files[0];
    if (!file) return;
    const blob = await compressPhoto(file);
    state.draftPhoto = blob;
    setThumb(blob);
    els.photoInput.value = '';
  });
  els.photoRemove.addEventListener('click', () => { state.draftPhoto = null; setThumb(null); });
  els.thumbBtn.addEventListener('click', () => {
    els.viewerImg.src = state.thumbUrl;
    els.viewer.showModal();
  });
  els.viewerClose.addEventListener('click', () => els.viewer.close());
  els.viewer.addEventListener('click', e => { if (e.target === els.viewer || e.target === els.viewerImg) els.viewer.close(); });

  els.menu.addEventListener('click', e => {
    const exp = e.target.closest('[data-export]');
    if (exp) { closeDialog(els.menu); exportExcel(exp.dataset.export); return; }
    if (e.target.closest('#backupSave')) { saveBackup(); return; }
    if (e.target === els.menu) closeDialog(els.menu); // tap outside the menu
  });
  els.restoreInput.addEventListener('change', () => {
    const file = els.restoreInput.files[0];
    els.restoreInput.value = '';
    closeDialog(els.menu);
    if (file) restoreBackup(file);
  });
}

/* ---------- Start ---------- */

async function start() {
  bind();
  try {
    await db.open();
    const saved = await db.all('expenses');
    state.expenses = saved.map(normalizeCategory);
    await Promise.all(state.expenses.filter((e, i) => e !== saved[i]).map(e => db.put('expenses', e)));
  } catch (err) {
    console.error(err);
    toast('Storage unavailable — entries won’t be saved', 'error');
  }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
