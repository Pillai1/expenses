'use strict';

const CATEGORIES = [
  { name: 'Food', emoji: '🍜' },
  { name: 'Groceries', emoji: '🛒' },
  { name: 'Transport', emoji: '🚇' },
  { name: 'Shopping', emoji: '🛍️' },
  { name: 'Bills', emoji: '🧾' },
  { name: 'Entertainment', emoji: '🎬' },
  { name: 'Health', emoji: '💊' },
  { name: 'Travel', emoji: '✈️' },
  { name: 'Others', emoji: '📦' },
];
const EMOJI = Object.fromEntries(CATEGORIES.map(c => [c.name, c.emoji]));
const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });
const moneyWhole = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 });
const moneyCompact = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', notation: 'compact', maximumFractionDigits: 1 });
const PHOTO_MAX_PX = 1600;

/* ---------- Dates ---------- */

function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayISO() { return toISO(new Date()); }
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

const state = {
  expenses: [],
  tab: 'list',
  month: monthOf(todayISO()),
  editing: null,       // expense being edited, or null for a new one
  category: null,      // selected category in the sheet
  draftPhoto: undefined, // undefined = unchanged, null = removed, Blob = new photo
  thumbUrl: null,
};

const $ = id => document.getElementById(id);
const els = {
  title: $('title'), monthLabel: $('monthLabel'), prevMonth: $('prevMonth'), nextMonth: $('nextMonth'),
  list: $('view-list'), summary: $('view-summary'), addBtn: $('addBtn'), exportBtn: $('exportBtn'),
  sheet: $('sheet'), sheetForm: $('sheetForm'), sheetTitle: $('sheetTitle'), cancelBtn: $('cancelBtn'),
  amount: $('amount'), amountWrap: $('amountWrap'), amountError: $('amountError'),
  chips: $('chips'), categoryError: $('categoryError'), date: $('date'), note: $('note'),
  photoAdd: $('photoAdd'), photoInput: $('photoInput'), photoPreview: $('photoPreview'),
  photoThumb: $('photoThumb'), thumbBtn: $('thumbBtn'), photoRemove: $('photoRemove'), deleteBtn: $('deleteBtn'),
  exportSheet: $('exportSheet'), exportMonth: $('exportMonth'), exportAll: $('exportAll'), exportCancel: $('exportCancel'),
  lastBackup: $('lastBackup'), backupSave: $('backupSave'), restoreInput: $('restoreInput'),
  viewer: $('viewer'), viewerImg: $('viewerImg'), viewerClose: $('viewerClose'), toast: $('toast'),
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sumCents(list) { return list.reduce((n, e) => n + e.cents, 0); }
function fmt(cents) { return money.format(cents / 100); }
function fmtShort(cents) { return (cents >= 1000000 ? moneyCompact : moneyWhole).format(cents / 100); }
function newestFirst(a, b) { return b.date.localeCompare(a.date) || b.createdAt - a.createdAt; }
function oldestFirst(a, b) { return a.date.localeCompare(b.date) || a.createdAt - b.createdAt; }
function inMonth(key) { return state.expenses.filter(e => monthOf(e.date) === key); }

/* ---------- Rendering ---------- */

const ICON_RECEIPT = '<svg viewBox="0 0 24 24" aria-label="Has receipt"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

function render() {
  const isList = state.tab === 'list';
  els.title.textContent = isList ? 'Expenses' : 'Summary';
  els.monthLabel.textContent = monthLabel(state.month);
  els.nextMonth.disabled = state.month >= monthOf(todayISO());
  els.list.hidden = !isList;
  els.summary.hidden = isList;
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.tab === state.tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (isList) renderList(); else renderSummary();
}

function heroHtml(items, extra = '') {
  const n = items.length;
  return `<div class="hero">
    <div class="hero-label">Spent in ${esc(monthLabel(state.month, { month: 'long' }))}</div>
    <div class="hero-value">${fmt(sumCents(items))}</div>
    <div class="hero-sub">${n} expense${n === 1 ? '' : 's'}${extra}</div>
  </div>`;
}

function renderList() {
  const items = inMonth(state.month).sort(newestFirst);
  if (!items.length) {
    els.list.innerHTML = heroHtml(items) + `<div class="empty"><div class="empty-icon">🧾</div>
      <strong>No expenses yet</strong>Tap + to add one for ${esc(monthLabel(state.month, { month: 'long' }))}.</div>`;
    return;
  }
  const days = new Map();
  for (const e of items) {
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
  }
  let html = heroHtml(items);
  for (const [date, list] of days) {
    html += `<div class="day"><div class="day-head"><span>${esc(dayLabel(date))}</span><span>${fmt(sumCents(list))}</span></div><div class="card">`;
    for (const e of list) {
      const title = e.note || e.category;
      const sub = e.note ? esc(e.category) : '';
      html += `<button class="item" data-id="${esc(e.id)}">
        <span class="emoji" aria-hidden="true">${EMOJI[e.category] || '📦'}</span>
        <span class="item-text"><span class="item-title">${esc(title)}</span>
          ${sub || e.hasPhoto ? `<span class="item-sub">${sub}${e.hasPhoto ? ICON_RECEIPT : ''}</span>` : ''}</span>
        <span class="item-amount">${fmt(e.cents)}</span>
      </button>`;
    }
    html += '</div></div>';
  }
  els.list.innerHTML = html;
}

function renderSummary() {
  const items = inMonth(state.month);
  const total = sumCents(items);
  const today = todayISO();
  const elapsed = state.month === monthOf(today) ? parseISO(today).getDate() : daysInMonth(state.month);
  let html = heroHtml(items, items.length ? ` · ${fmt(Math.round(total / elapsed))}/day avg` : '');

  if (items.length) {
    const byCat = new Map();
    for (const e of items) byCat.set(e.category, (byCat.get(e.category) || 0) + e.cents);
    const rows = [...byCat].sort((a, b) => b[1] - a[1]);
    const max = rows[0][1];
    html += '<h2 class="section-title">By category</h2><div class="summary-card">';
    for (const [cat, cents] of rows) {
      const pct = Math.round((cents / total) * 100);
      html += `<div class="cat-row">
        <div class="cat-line">
          <span aria-hidden="true">${EMOJI[cat] || '📦'}</span>
          <span class="cat-name">${esc(cat)}</span>
          <span class="cat-pct">${pct}%</span>
          <span class="cat-amount">${fmt(cents)}</span>
        </div>
        <div class="bar-track"><div class="bar" style="width:${(cents / max) * 100}%"></div></div>
      </div>`;
    }
    html += '</div>';
  }

  const months = [];
  for (let i = 5; i >= 0; i--) months.push(shiftMonth(state.month, -i));
  const totals = months.map(m => sumCents(inMonth(m)));
  const peak = Math.max(...totals, 1);
  html += '<h2 class="section-title">Last 6 months</h2><div class="summary-card"><div class="trend">';
  months.forEach((m, i) => {
    const h = (totals[i] / peak) * 100;
    const full = `${monthLabel(m)}: ${fmt(totals[i])}`;
    html += `<button class="trend-col" data-month="${m}" aria-label="${esc(full)}" title="${esc(full)}"${m === state.month ? ' aria-current="true"' : ''}>
      <span class="trend-value">${totals[i] ? esc(fmtShort(totals[i])) : ''}</span>
      <span class="trend-bar" style="height:${totals[i] ? Math.max(h * 0.72, 2) : 0}%"></span>
      <span class="trend-label">${esc(monthLabel(m, { month: 'short' }))}</span>
    </button>`;
  });
  html += '</div></div>';
  els.summary.innerHTML = html;
}

/* ---------- Add / edit sheet ---------- */

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
  els.amount.value = expense ? (expense.cents / 100).toFixed(2) : '';
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
  const cents = parseAmount(els.amount.value);
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

/* ---------- Excel export ---------- */

function buildWorkbook(list) {
  const X = XLSXWriter;
  const S = X.STYLE;
  const sorted = [...list].sort(oldestFirst);

  const rows = [['Date', 'Category', 'Description', 'Amount (SGD)', 'Receipt'].map(v => ({ v, s: S.header }))];
  for (const e of sorted) {
    rows.push([
      { v: X.dateSerial(e.date), s: S.date },
      e.category,
      e.note,
      { v: e.cents / 100, s: S.money },
      e.hasPhoto ? 'Yes' : '',
    ]);
  }
  const lastRow = rows.length;
  rows.push([
    { v: 'Total', s: S.totalLabel }, { s: S.totalLabel }, { s: S.totalLabel },
    { f: `SUM(D2:D${lastRow})`, v: sumCents(sorted) / 100, s: S.totalMoney },
    { s: S.totalLabel },
  ]);
  const expensesSheet = { name: 'Expenses', rows, widths: [13, 15, 40, 15, 9], freezeHeader: true, autoFilter: `A1:E${lastRow}` };

  // Summary: one row per month, one column per category (biggest spend first).
  const catTotals = new Map();
  const grid = new Map();
  for (const e of sorted) {
    const m = monthOf(e.date);
    catTotals.set(e.category, (catTotals.get(e.category) || 0) + e.cents);
    if (!grid.has(m)) grid.set(m, new Map());
    grid.get(m).set(e.category, (grid.get(m).get(e.category) || 0) + e.cents);
  }
  const cats = [...catTotals].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const months = [...grid.keys()].sort();
  const lastCatCol = X.colName(cats.length);
  const totalCol = X.colName(cats.length + 1);
  const sRows = [['Month', ...cats, 'Total'].map(v => ({ v, s: S.header }))];
  months.forEach((m, i) => {
    const r = i + 2;
    const cells = grid.get(m);
    const rowTotal = [...cells.values()].reduce((a, b) => a + b, 0);
    sRows.push([
      { v: X.dateSerial(m + '-01'), s: S.month },
      ...cats.map(c => (cells.get(c) ? { v: cells.get(c) / 100, s: S.money } : null)),
      { f: `SUM(B${r}:${lastCatCol}${r})`, v: rowTotal / 100, s: S.money },
    ]);
  });
  const lastS = sRows.length;
  sRows.push([
    { v: 'Total', s: S.totalLabel },
    ...cats.map((c, i) => {
      const col = X.colName(i + 1);
      return { f: `SUM(${col}2:${col}${lastS})`, v: catTotals.get(c) / 100, s: S.totalMoney };
    }),
    { f: `SUM(${totalCol}2:${totalCol}${lastS})`, v: sumCents(sorted) / 100, s: S.totalMoney },
  ]);
  const summarySheet = { name: 'Summary', rows: sRows, widths: [12, ...cats.map(() => 14), 14], freezeHeader: true };

  return X.build([expensesSheet, summarySheet]);
}

function openExportSheet() {
  const monthCount = inMonth(state.month).length;
  const allCount = state.expenses.length;
  els.exportMonth.textContent = `${monthLabel(state.month)} (${monthCount})`;
  els.exportMonth.disabled = !monthCount;
  els.exportAll.textContent = `All expenses (${allCount})`;
  els.exportAll.disabled = !allCount;
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

async function exportExcel(scope) {
  const list = scope === 'all' ? state.expenses : inMonth(state.month);
  if (!list.length) { toast('Nothing to export'); return; }
  const name = scope === 'all' ? `Expenses-all-${todayISO()}.xlsx` : `Expenses-${state.month}.xlsx`;
  const file = new File([buildWorkbook(list)], name, { type: XLSXWriter.MIME });
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
    Number.isInteger(x.cents) && x.cents > 0 &&
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
      expense: {
        id: x.id, date: x.date, cents: x.cents, category: x.category,
        note: typeof x.note === 'string' ? x.note : '',
        createdAt: Number(x.createdAt) || Date.now(),
        hasPhoto: !!photo,
      },
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
  els.prevMonth.addEventListener('click', () => { state.month = shiftMonth(state.month, -1); render(); });
  els.nextMonth.addEventListener('click', () => { state.month = shiftMonth(state.month, 1); render(); });
  els.monthLabel.addEventListener('click', () => { state.month = monthOf(todayISO()); render(); });

  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); window.scrollTo(0, 0); }));

  els.list.addEventListener('click', e => {
    const item = e.target.closest('.item');
    if (item) openSheet(state.expenses.find(x => x.id === item.dataset.id));
  });
  els.summary.addEventListener('click', e => {
    const col = e.target.closest('.trend-col');
    if (col) { state.month = col.dataset.month; render(); }
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
    state.expenses = await db.all('expenses');
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
