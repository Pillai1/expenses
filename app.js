'use strict';

const CATEGORIES = [
  { name: 'Food', emoji: '🍜', fill: 'FFFFC000' },
  { name: 'Entertainment', emoji: '🎬', fill: 'FF8497B0' },
  { name: 'PayNow/Paylah', emoji: '💸', fill: 'FF92D050' },
  { name: 'Transport', emoji: '🚇', fill: 'FF00B0F0' },
  { name: 'Cab', emoji: '🚕', fill: 'FFFFFF00' },
  { name: 'Phone Bill', emoji: '📱', fill: 'FFFFE699' },
  { name: 'Clothing/Shoe', emoji: '👟', fill: 'FFA9D18E' },
  { name: 'Others', emoji: '📦', fill: 'FFF4B183' },
];
const CATEGORY_NAMES = new Set(CATEGORIES.map(c => c.name));
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMOJI = Object.fromEntries(CATEGORIES.map(c => [c.name, c.emoji]));
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
  tab: 'list',
  month: monthOf(todayISO()), // month shown on the Expenses tab
  year: thisYear(),           // year shown on the Dashboard
  dashMonth: null,            // month picked in the Dashboard chart
  catScope: 'month',          // Dashboard category breakdown: 'month' or 'year'
  editing: null,       // expense being edited, or null for a new one
  category: null,      // selected category in the sheet
  draftPhoto: undefined, // undefined = unchanged, null = removed, Blob = new photo
  sign: 1,             // 1 = spent, -1 = received (paybacks, refunds) in the sheet
  hidden: readHidden(), // amounts masked with asterisks
  detail: null,        // { category, key: 'YYYY' | 'YYYY-MM' } for the category detail view
  thumbUrl: null,
};

const $ = id => document.getElementById(id);
const els = {
  title: $('title'), monthLabel: $('monthLabel'), prevMonth: $('prevMonth'), nextMonth: $('nextMonth'),
  list: $('view-list'), dash: $('view-dash'), addBtn: $('addBtn'), exportBtn: $('exportBtn'),
  sheet: $('sheet'), sheetForm: $('sheetForm'), sheetTitle: $('sheetTitle'), cancelBtn: $('cancelBtn'),
  amount: $('amount'), amountWrap: $('amountWrap'), amountError: $('amountError'),
  chips: $('chips'), categoryError: $('categoryError'), date: $('date'), note: $('note'),
  photoAdd: $('photoAdd'), photoInput: $('photoInput'), photoPreview: $('photoPreview'),
  photoThumb: $('photoThumb'), thumbBtn: $('thumbBtn'), photoRemove: $('photoRemove'), deleteBtn: $('deleteBtn'),
  exportSheet: $('exportSheet'), exportGroup: $('exportGroup'), exportCancel: $('exportCancel'),
  lastBackup: $('lastBackup'), backupSave: $('backupSave'), restoreInput: $('restoreInput'),
  viewer: $('viewer'), viewerImg: $('viewerImg'), viewerClose: $('viewerClose'), toast: $('toast'),
  hideBtn: $('hideBtn'), signSeg: $('signSeg'), currency: $('currency'),
  detail: $('detail'), detailTitle: $('detailTitle'), detailBody: $('detailBody'), detailClose: $('detailClose'),
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

// Expenses saved under the app's earlier category list move to Others, keeping the old name as the description.
function normalizeCategory(e) {
  if (CATEGORY_NAMES.has(e.category)) return e;
  return { ...e, category: 'Others', note: e.note || e.category };
}

/* ---------- Rendering ---------- */

const ICON_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const ICON_CHEVRON = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const ICON_RECEIPT = '<svg viewBox="0 0 24 24" aria-label="Has receipt"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

function render() {
  const isList = state.tab === 'list';
  els.title.textContent = isList ? 'Expenses' : 'Dashboard';
  els.monthLabel.textContent = isList ? monthLabel(state.month) : String(state.year);
  els.nextMonth.disabled = isList ? state.month >= monthOf(todayISO()) : state.year >= thisYear();
  els.prevMonth.setAttribute('aria-label', isList ? 'Previous month' : 'Previous year');
  els.nextMonth.setAttribute('aria-label', isList ? 'Next month' : 'Next year');
  els.list.hidden = !isList;
  els.dash.hidden = isList;
  els.hideBtn.innerHTML = state.hidden ? ICON_EYE_OFF : ICON_EYE;
  els.hideBtn.setAttribute('aria-pressed', String(state.hidden));
  els.hideBtn.setAttribute('aria-label', state.hidden ? 'Show amounts' : 'Hide amounts');
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.tab === state.tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (isList) renderList(); else renderDashboard();
}

// The header arrows move the month on the Expenses tab and the year on the Dashboard.
function shiftPeriod(delta) {
  if (state.tab === 'list') state.month = shiftMonth(state.month, delta);
  else state.year += delta;
  render();
}

function toggleHidden() {
  state.hidden = !state.hidden;
  try { localStorage.setItem(HIDE_KEY, state.hidden ? '1' : '0'); } catch {}
  render();
  if (els.detail.open) renderDetail();
}

function resetPeriod() {
  state.month = monthOf(todayISO());
  state.year = thisYear();
  render();
}

function heroHtml(label, cents, sub) {
  return `<div class="hero">
    <div class="hero-label">${esc(label)}</div>
    <div class="hero-value">${fmt(cents)}</div>
    <div class="hero-sub">${esc(sub)}</div>
  </div>`;
}

function dayGroupsHtml(items) {
  const days = new Map();
  for (const e of items) {
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
  }
  let html = '';
  for (const [date, list] of days) {
    html += `<div class="day"><div class="day-head"><span>${esc(dayLabel(date))}</span><span>${fmt(sumCents(list))}</span></div><div class="card">`;
    for (const e of list) {
      const sub = [e.note ? esc(e.category) : '', e.cents < 0 ? 'Received' : ''].filter(Boolean).join(' · ');
      html += `<button class="item" data-id="${esc(e.id)}">
        <span class="emoji" aria-hidden="true">${EMOJI[e.category] || '📦'}</span>
        <span class="item-text"><span class="item-title">${esc(e.note || e.category)}</span>
          ${sub || e.hasPhoto ? `<span class="item-sub">${sub}${e.hasPhoto ? ICON_RECEIPT : ''}</span>` : ''}</span>
        <span class="item-amount${e.cents < 0 ? ' received' : ''}">${fmt(e.cents)}</span>
      </button>`;
    }
    html += '</div></div>';
  }
  return html;
}

function renderList() {
  const items = inMonth(state.month).sort(newestFirst);
  const n = items.length;
  const monthName = monthLabel(state.month, { month: 'long' });
  const html = heroHtml(`Spent in ${monthName}`, sumCents(items), `${n} expense${n === 1 ? '' : 's'}`);
  els.list.innerHTML = html + (n ? dayGroupsHtml(items) : `<div class="empty"><div class="empty-icon">🧾</div>
      <strong>No expenses yet</strong>Tap + to add one for ${esc(monthName)}.</div>`);
}

// Net per category (money received reduces it). Spending categories get a bar; net-received ones are listed last.
function categoryRows(items) {
  const byCat = new Map();
  for (const e of items) byCat.set(e.category, (byCat.get(e.category) || 0) + e.cents);
  const rows = [...byCat].filter(([, c]) => c !== 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<p class="dash-empty">Nothing spent yet</p>';
  const spent = rows.reduce((n, [, c]) => n + Math.max(c, 0), 0);
  const max = Math.max(rows[0][1], 1);
  return rows.map(([cat, cents]) => {
    const pct = cents <= 0 ? '' : cents / spent < 0.005 ? '<1%' : `${Math.round((cents / spent) * 100)}%`;
    return `<button class="cat-row" data-cat="${esc(cat)}">
      <span class="cat-line">
        <span aria-hidden="true">${EMOJI[cat] || '📦'}</span>
        <span class="cat-name">${esc(cat)}</span>
        <span class="cat-pct">${pct}</span>
        <span class="cat-amount${cents < 0 ? ' received' : ''}">${fmt(cents)}</span>
        ${ICON_CHEVRON}
      </span>
      ${cents > 0 ? `<span class="bar-track"><span class="bar" style="width:${(cents / max) * 100}%"></span></span>` : ''}
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
  const selName = MONTH_SHORT[Number(sel.slice(5)) - 1];
  const selTotal = totals[Number(sel.slice(5)) - 1];
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
  html += `<div class="dash-card">
    <div class="dash-head"><span>${esc(monthLabel(sel, { month: 'long' }))}</span><strong>${fmt(selTotal)}</strong></div>
    <div class="dash-sub">${change ? esc(change) : '&nbsp;'}</div>
    <div class="months">${months.map((m, i) => `<button class="month-col" data-month="${m}" aria-label="${esc(`${monthLabel(m)}: ${fmt(totals[i])}`)}"${m === sel ? ' aria-current="true"' : ''}>
        <span class="month-track"><span class="month-bar" style="height:${totals[i] > 0 ? Math.max((totals[i] / peak) * 100, 3) : 0}%"></span></span>
        <span class="month-name">${MONTH_SHORT[i]}</span>
      </button>`).join('')}</div>
  </div>`;

  const byYear = state.catScope === 'year';
  html += `<div class="dash-row">
    <h2 class="section-title">By category</h2>
    <div class="seg" role="group" aria-label="Show categories for">
      <button data-scope="month" aria-pressed="${!byYear}">${selName}</button>
      <button data-scope="year" aria-pressed="${byYear}">${year}</button>
    </div>
  </div>
  <div class="summary-card">${categoryRows(byYear ? yearItems : inMonth(sel))}</div>`;
  els.dash.innerHTML = html;
}

/* ---------- Category detail (from the Dashboard) ---------- */

function openDetail(category) {
  state.detail = { category, key: state.catScope === 'year' ? String(state.year) : state.dashMonth };
  renderDetail();
  document.body.classList.add('locked');
  els.detail.showModal();
  els.detailBody.scrollTop = 0;
}

function renderDetail() {
  const { category, key } = state.detail;
  const items = state.expenses.filter(e => e.category === category && e.date.startsWith(`${key}-`)).sort(newestFirst);
  const n = items.length;
  els.detailTitle.textContent = `${EMOJI[category] || '📦'} ${category}`;
  let html = heroHtml(key.length === 4 ? key : monthLabel(key), sumCents(items), `${n} expense${n === 1 ? '' : 's'}`);

  // Where it went: one row per description (e.g. "Economy rice 12×"), biggest first.
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
    html += '<h2 class="section-title">Where it went</h2><div class="summary-card">' + shown.map(p => `<div class="place-row">
        <span class="place-name">${esc(p.name)}</span>
        <span class="place-count">${p.count}×</span>
        <span class="place-amount${p.cents < 0 ? ' received' : ''}">${fmt(p.cents)}</span>
      </div>`).join('') + '</div>';
  }
  html += n ? '<h2 class="section-title">All expenses</h2>' + dayGroupsHtml(items) : '<p class="dash-empty">Nothing here yet</p>';
  els.detailBody.innerHTML = html;
}

/* ---------- Add / edit sheet ---------- */

function setSign(sign) {
  state.sign = sign;
  els.signSeg.querySelectorAll('[data-sign]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.sign) === sign)));
  els.currency.textContent = sign < 0 ? '−$' : '$';
  els.amountWrap.classList.toggle('received', sign < 0);
}

function renderChips() {
  els.chips.innerHTML = CATEGORIES.map(c =>
    `<button type="button" class="chip" role="radio" data-cat="${esc(c.name)}" aria-checked="${c.name === state.category}">
      <span class="chip-emoji" aria-hidden="true">${c.emoji}</span>${esc(c.name)}</button>`
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
  els.sheetTitle.textContent = expense ? 'Edit expense' : 'New expense';
  els.amount.value = expense ? (Math.abs(expense.cents) / 100).toFixed(2) : '';
  setSign(expense && expense.cents < 0 ? -1 : 1);
  sizeAmount();
  els.date.value = expense ? expense.date : todayISO();
  els.note.value = expense ? expense.note : '';
  els.amountError.hidden = true;
  els.categoryError.hidden = true;
  els.deleteBtn.hidden = !expense;
  els.deleteBtn.classList.remove('confirm');
  els.deleteBtn.textContent = 'Delete expense';
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
  els.sheet.close();
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
    toast('Could not save — storage error');
    return;
  }
  const i = state.expenses.findIndex(e => e.id === expense.id);
  if (i >= 0) state.expenses[i] = expense; else state.expenses.push(expense);
  state.month = monthOf(expense.date);
  closeSheet();
  render();
  if (els.detail.open) renderDetail();
  toast(isEdit ? 'Updated' : 'Saved');
}

let deleteTimer = 0;
async function deleteExpense() {
  const btn = els.deleteBtn;
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.textContent = 'Tap again to delete';
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = 'Delete expense'; }, 3000);
    return;
  }
  clearTimeout(deleteTimer);
  const { id } = state.editing;
  try {
    await db.del('expenses', id);
    await db.del('photos', id);
  } catch (err) {
    console.error(err);
    toast('Could not delete — storage error');
    return;
  }
  state.expenses = state.expenses.filter(e => e.id !== id);
  closeSheet();
  render();
  if (els.detail.open) renderDetail();
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

function openExportSheet() {
  const counts = new Map();
  for (const e of state.expenses) {
    const y = e.date.slice(0, 4);
    counts.set(y, (counts.get(y) || 0) + 1);
  }
  const years = [...counts.keys()].sort().reverse();
  els.exportGroup.innerHTML = '<div class="action-title">Export to Excel</div>' + (years.length
    ? years.map(y => `<button type="button" data-export="${y}">${y} (${counts.get(y)} expense${counts.get(y) === 1 ? '' : 's'})</button>`).join('')
    : '<button type="button" disabled>No expenses yet</button>');
  resetBackupButton();
  const last = readLastBackup();
  els.lastBackup.textContent = last
    ? `Last saved ${new Date(last).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : 'Not backed up yet';
  els.exportSheet.showModal();
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

function resetBackupButton() {
  preparedBackup = null;
  els.backupSave.disabled = false;
  els.backupSave.textContent = 'Save backup file';
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

async function saveBackup() {
  const btn = els.backupSave;
  if (!state.expenses.length) { toast('Nothing to back up yet'); return; }
  if (!preparedBackup) {
    btn.disabled = true;
    btn.textContent = 'Preparing backup…';
    try {
      preparedBackup = await buildBackup();
    } catch (err) {
      console.error(err);
      resetBackupButton();
      toast('Could not create backup');
      return;
    }
    if (!els.exportSheet.open) { resetBackupButton(); return; } // cancelled while preparing
  }
  const result = await saveFile(preparedBackup);
  if (result === 'blocked') {
    // Gathering photos took long enough that iOS needs another tap to open the Share sheet.
    btn.disabled = false;
    btn.textContent = 'Backup ready · tap to save';
    return;
  }
  els.exportSheet.close();
  if (result === 'done') {
    try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch {}
    toast('Backup saved');
  }
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
    toast('That file isn’t an Expenses backup');
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
    toast('Could not restore — storage error');
    return;
  }
  state.expenses.push(...records.map(r => r.expense));
  render();
  toast(`Restored ${records.length} expense${records.length === 1 ? '' : 's'}`);
}

/* ---------- Toast ---------- */

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

/* ---------- Events ---------- */

function bind() {
  els.addBtn.addEventListener('click', () => openSheet(null));
  els.exportBtn.addEventListener('click', openExportSheet);
  els.hideBtn.addEventListener('click', toggleHidden);
  els.signSeg.addEventListener('click', e => {
    const btn = e.target.closest('[data-sign]');
    if (btn) setSign(Number(btn.dataset.sign));
  });
  els.detailClose.addEventListener('click', () => els.detail.close());
  els.detail.addEventListener('close', () => { if (!els.sheet.open) document.body.classList.remove('locked'); });
  els.detailBody.addEventListener('click', e => {
    const item = e.target.closest('.item');
    if (item) openSheet(state.expenses.find(x => x.id === item.dataset.id));
  });
  els.prevMonth.addEventListener('click', () => shiftPeriod(-1));
  els.nextMonth.addEventListener('click', () => shiftPeriod(1));
  els.monthLabel.addEventListener('click', resetPeriod);

  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); window.scrollTo(0, 0); }));

  els.list.addEventListener('click', e => {
    const item = e.target.closest('.item');
    if (item) openSheet(state.expenses.find(x => x.id === item.dataset.id));
  });
  els.dash.addEventListener('click', e => {
    const col = e.target.closest('.month-col');
    const scope = e.target.closest('[data-scope]');
    const cat = e.target.closest('.cat-row');
    if (cat) { openDetail(cat.dataset.cat); return; }
    if (col) state.dashMonth = col.dataset.month;
    else if (scope) state.catScope = scope.dataset.scope;
    else return;
    render();
  });

  els.chips.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.cat;
    els.categoryError.hidden = true;
    els.chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-checked', String(c === chip)));
    if (document.activeElement === els.amount) els.amount.blur();
  });
  els.amount.addEventListener('input', () => { els.amountError.hidden = true; sizeAmount(); });
  els.amount.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); els.amount.blur(); } });
  els.note.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); els.note.blur(); } });

  els.sheetForm.addEventListener('submit', e => { e.preventDefault(); saveSheet(); });
  els.cancelBtn.addEventListener('click', closeSheet);
  els.deleteBtn.addEventListener('click', deleteExpense);
  els.sheet.addEventListener('close', () => {
    if (!els.detail.open) document.body.classList.remove('locked');
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

  els.exportSheet.addEventListener('click', e => {
    const btn = e.target.closest('[data-export]');
    if (btn) { els.exportSheet.close(); exportExcel(btn.dataset.export); return; }
    if (e.target === els.exportSheet) els.exportSheet.close(); // tap on backdrop
  });
  els.exportCancel.addEventListener('click', () => els.exportSheet.close());
  els.exportSheet.addEventListener('close', resetBackupButton);
  els.backupSave.addEventListener('click', saveBackup);
  els.restoreInput.addEventListener('change', () => {
    const file = els.restoreInput.files[0];
    els.restoreInput.value = '';
    els.exportSheet.close();
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
    toast('Storage unavailable — entries won’t be saved');
  }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
