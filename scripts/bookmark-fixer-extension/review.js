/* review.js — match TSV data with Chrome bookmarks, review, execute, restore */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const TAG_CLASS = { delete: 'tag-delete', upgrade_https: 'tag-upgrade', review: 'tag-review', keep: 'tag-keep' };
const TAB_ORDER = ['upgrade_https', 'delete', 'review', 'keep'];
const TAB_LABELS = { upgrade_https: 'review.tab_upgrade', delete: 'review.tab_delete', review: 'review.tab_review', keep: 'review.tab_keep' };
const ACTIONABLE = new Set(['upgrade_https', 'delete', 'review']);
const VALID_RESTORE_ACTIONS = new Set(['upgrade', 'delete']);

let allItems = [];
let unmatched = [];
let currentTab = '';
let executing = false;
let batchId = '';
let dataSource = '';

// ── Init ──

(async () => {
  await initI18n();
  const params = new URLSearchParams(location.search);
  batchId = params.get('batch') || '';
  dataSource = params.get('source') || 'tsv';
  if (params.get('mode') === 'restore') {
    await initRestore();
  } else if (dataSource === 'scan') {
    await initReviewFromScan();
  } else {
    await initReview();
  }
})();

// ── Review mode (TSV) ──

async function initReview() {
  if (!batchId) {
    $('h1 span').textContent = t('review.no_batch');
    return;
  }
  const storageKey = `tsv_data_${batchId}`;
  const stored = await chrome.storage.local.get(storageKey);
  const tsvRows = stored[storageKey];
  if (!tsvRows || tsvRows.length === 0) {
    $('h1 span').textContent = t('review.no_tsv');
    return;
  }

  $('h1 span').textContent = t('review.matching', { count: tsvRows.length });

  const tree = await chrome.bookmarks.getTree();
  const flatBookmarks = flattenTree(tree);
  const urlMap = new Map();
  for (const bm of flatBookmarks) {
    if (!bm.url) continue;
    if (!urlMap.has(bm.url)) urlMap.set(bm.url, []);
    urlMap.get(bm.url).push(bm);
  }
  const folderPaths = buildFolderPaths(tree);
  const seenBookmarkIds = new Set();

  for (const row of tsvRows) {
    const url = row.url;
    if (!url) continue;
    const bookmarks = urlMap.get(url);
    if (!bookmarks || bookmarks.length === 0) {
      unmatched.push(row);
      continue;
    }
    for (const bm of bookmarks) {
      if (seenBookmarkIds.has(bm.id)) continue;
      seenBookmarkIds.add(bm.id);
      const rec = row.recommendation || 'keep';
      const isManaged = bm.unmodifiable === 'managed';
      const isSyncing = bm.syncing === true;
      const defaultSelected = !isManaged && isSyncing && (rec === 'delete' || rec === 'upgrade_https');
      allItems.push({
        bookmark: bm, tsv: row,
        folderPath: folderPaths.get(bm.parentId) || '',
        recommendation: rec, selected: defaultSelected,
        managed: isManaged, syncing: bm.syncing,
      });
    }
  }

  await chrome.storage.local.remove(storageKey).catch(() => {});

  if (unmatched.length > 0) {
    const box = $('#unmatched-box');
    box.style.display = '';
    $('#unmatched-count').textContent = unmatched.length;
    $('#unmatched-list').innerHTML = unmatched.map((r) => `<div>${escapeHTML(r.url)}</div>`).join('');
    box.addEventListener('click', () => box.classList.toggle('expanded'));
  }

  $('h1 span').textContent = t('review.matched', { matched: allItems.length, unmatched: unmatched.length });
  buildTabs();
  const firstTab = TAB_ORDER.find((key) => allItems.some((i) => i.recommendation === key));
  if (firstTab) switchTab(firstTab);
  bindControls();
}

// ── Review from scan results ──

async function initReviewFromScan() {
  if (!batchId) {
    $('h1 span').textContent = t('review.no_scan_batch');
    return;
  }
  const storageKey = `scan_data_${batchId}`;
  const stored = await chrome.storage.local.get(storageKey);
  const scanResults = stored[storageKey];
  if (!scanResults || scanResults.length === 0) {
    $('h1 span').textContent = t('review.no_scan_data');
    return;
  }

  await chrome.storage.local.remove(storageKey).catch(() => {});
  $('h1 span').textContent = t('review.loading_scan', { count: scanResults.length });

  for (const item of scanResults) {
    if (item.classification === 'skipped') continue;
    const rec = item.recommendation || 'keep';
    const isManaged = item.unmodifiable === 'managed';
    const isSyncing = item.syncing === true;
    const defaultSelected = !isManaged && isSyncing && (rec === 'delete' || rec === 'upgrade_https');
    allItems.push({
      bookmark: {
        id: item.bookmarkId, parentId: item.parentId, index: item.index,
        title: item.title, url: item.url, syncing: item.syncing, unmodifiable: item.unmodifiable,
      },
      tsv: item, folderPath: item.folderPath || '',
      recommendation: rec, selected: defaultSelected,
      managed: isManaged, syncing: item.syncing,
    });
  }

  $('h1 span').textContent = t('review.bookmarks_to_review', { count: allItems.length });
  buildTabs();
  const firstTab = TAB_ORDER.find((key) => allItems.some((i) => i.recommendation === key));
  if (firstTab) switchTab(firstTab);
  bindControls();
}

// ── Restore mode ──

async function initRestore() {
  if (!batchId) {
    $('h1 span').textContent = t('review.no_batch');
    return;
  }
  const storageKey = `restore_log_${batchId}`;
  const stored = await chrome.storage.local.get(storageKey);
  const log = stored[storageKey];
  if (!log || log.length === 0) {
    $('h1 span').textContent = t('review.no_restore_log');
    return;
  }

  await chrome.storage.local.remove(storageKey).catch(() => {});

  const validEntries = [];
  const invalidCount = { missing: 0, badAction: 0 };
  for (const entry of log) {
    if (entry.status !== 'ok') continue;
    if (!entry.id || !entry.oldUrl || !entry.action) { invalidCount.missing++; continue; }
    if (!VALID_RESTORE_ACTIONS.has(entry.action)) { invalidCount.badAction++; continue; }
    if (entry.action === 'upgrade' && !entry.newUrl) { invalidCount.missing++; continue; }
    if (entry.action === 'delete' && !entry.parentId) { invalidCount.missing++; continue; }
    try {
      const oldParsed = new URL(entry.oldUrl);
      if (oldParsed.protocol !== 'http:' && oldParsed.protocol !== 'https:') { invalidCount.badAction++; continue; }
      if (entry.newUrl) {
        const newParsed = new URL(entry.newUrl);
        if (newParsed.protocol !== 'http:' && newParsed.protocol !== 'https:') { invalidCount.badAction++; continue; }
      }
    } catch { invalidCount.missing++; continue; }
    validEntries.push(entry);
  }

  const restoreBox = $('#restore-box');
  restoreBox.style.display = '';
  let info = t('review.restore_mode', { count: validEntries.length });
  if (invalidCount.missing > 0 || invalidCount.badAction > 0) {
    info += ' ' + t('review.restore_skipped', { missing: invalidCount.missing, badAction: invalidCount.badAction });
  }
  restoreBox.textContent = info;

  if (validEntries.length === 0) {
    $('h1 span').textContent = t('review.no_valid_entries');
    return;
  }

  $('h1 span').textContent = t('review.restore_title');
  $('#toolbar').style.display = 'none';
  $('#tabs').style.display = 'none';

  const tbody = $('#tbody');
  tbody.innerHTML = '';
  for (const entry of validEntries) {
    const tr = document.createElement('tr');
    const tdCb = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true;
    tdCb.appendChild(cb);
    const tdTitle = document.createElement('td'); tdTitle.textContent = entry.title || '';
    const tdUrl = document.createElement('td'); tdUrl.className = 'url-cell'; tdUrl.title = entry.oldUrl || ''; tdUrl.textContent = entry.oldUrl || '';
    const tdAction = document.createElement('td'); tdAction.className = 'folder-cell'; tdAction.textContent = entry.action;
    const tdId = document.createElement('td'); tdId.textContent = entry.id;
    const tdTag = document.createElement('td');
    const span = document.createElement('span');
    span.className = `tag tag-${entry.action === 'delete' ? 'delete' : 'upgrade'}`;
    span.textContent = t('review.undo_label', { action: entry.action });
    tdTag.appendChild(span);
    tr.append(tdCb, tdTitle, tdUrl, tdAction, tdId, tdTag);
    tbody.appendChild(tr);
  }

  $('#btn-exec').textContent = t('review.restore_btn');
  $('#btn-exec').addEventListener('click', () => executeRestore(validEntries));
}

async function executeRestore(entries) {
  if (executing) return;

  const lockCheck = await chrome.storage.local.get(['pending_changelog', 'pending_restore_journal', 'executing_batch']);
  if (lockCheck.pending_changelog || lockCheck.pending_restore_journal || lockCheck.executing_batch) {
    alert(t('review.lock_error'));
    return;
  }

  executing = true;
  const btn = $('#btn-exec'); btn.disabled = true;
  const bar = $('#progress-bar');
  const summary = $('#summary');
  summary.textContent = t('review.restoring');

  const checkboxes = $$('#tbody input[type="checkbox"]');
  const selected = entries.filter((_, i) => checkboxes[i] && checkboxes[i].checked);
  const deletes = selected.filter((e) => e.action === 'delete').sort((a, b) => (a.index || 0) - (b.index || 0));
  const upgrades = selected.filter((e) => e.action === 'upgrade');
  const ops = [...upgrades, ...deletes];

  const restoreJournal = ops.map((entry) => ({ ...entry, restoreStatus: 'pending', restoreError: null }));

  try {
    await chrome.storage.local.set({ pending_restore_journal: restoreJournal, executing_batch: { batchId: batchId || 'restore', since: Date.now() } });
  } catch (e) {
    summary.textContent = t('review.restore_journal_error', { message: e.message });
    summary.className = 'summary error'; btn.disabled = false; executing = false; return;
  }

  let done = 0, ok = 0, fail = 0, journalStale = false;

  for (const jEntry of restoreJournal) {
    try {
      if (jEntry.action === 'upgrade') {
        const current = await chrome.bookmarks.get(jEntry.id);
        if (!current || current.length === 0) {
          jEntry.restoreStatus = 'skipped'; jEntry.restoreError = 'bookmark no longer exists';
          done++; bar.style.width = `${(done / ops.length) * 100}%`;
          journalStale = !(await persistJournal('pending_restore_journal', restoreJournal)) || journalStale; continue;
        }
        if (current[0].url !== jEntry.newUrl) {
          jEntry.restoreStatus = 'skipped'; jEntry.restoreError = `URL already changed`;
          done++; bar.style.width = `${(done / ops.length) * 100}%`;
          journalStale = !(await persistJournal('pending_restore_journal', restoreJournal)) || journalStale; continue;
        }
        await chrome.bookmarks.update(jEntry.id, { url: jEntry.oldUrl });
      } else if (jEntry.action === 'delete') {
        const existing = await chrome.bookmarks.search({ url: jEntry.oldUrl });
        const alreadyRestored = existing.some((b) => b.parentId === jEntry.parentId && b.title === jEntry.title);
        if (alreadyRestored) {
          jEntry.restoreStatus = 'skipped'; jEntry.restoreError = 'bookmark already exists';
          done++; bar.style.width = `${(done / ops.length) * 100}%`;
          journalStale = !(await persistJournal('pending_restore_journal', restoreJournal)) || journalStale; continue;
        }
        await chrome.bookmarks.create({ parentId: jEntry.parentId, index: jEntry.index, title: jEntry.title, url: jEntry.oldUrl });
      }
      jEntry.restoreStatus = 'ok'; ok++;
    } catch (e) {
      jEntry.restoreStatus = 'error'; jEntry.restoreError = e.message; fail++;
      console.error('Restore failed:', jEntry, e);
    }
    done++; bar.style.width = `${(done / ops.length) * 100}%`;
    journalStale = !(await persistJournal('pending_restore_journal', restoreJournal)) || journalStale;
    if (done % 10 === 0) await yieldUI();
  }

  await chrome.storage.local.remove(['pending_restore_journal', 'executing_batch']).catch(() => {});
  let msg = t('review.restore_complete', { ok, fail, skipped: ops.length - ok - fail });
  if (journalStale) msg += t('review.restore_journal_warning');
  summary.textContent = msg;
  summary.className = (fail > 0 || journalStale) ? 'summary error' : 'summary';
  executing = false;
}

// ── Tree utilities ──

function flattenTree(nodes) {
  const result = [];
  function walk(children) {
    for (const node of children) {
      if (node.url) result.push(node);
      if (node.children) walk(node.children);
    }
  }
  for (const root of nodes) { if (root.children) walk(root.children); }
  return result;
}

function buildFolderPaths(tree) {
  const paths = new Map();
  function walk(node, path) {
    const currentPath = node.title ? (path ? `${path}/${node.title}` : node.title) : path;
    paths.set(node.id, currentPath);
    if (node.children) { for (const child of node.children) walk(child, currentPath); }
  }
  for (const root of tree) walk(root, '');
  return paths;
}

// ── Tabs ──

function buildTabs() {
  const counts = {};
  for (const item of allItems) counts[item.recommendation] = (counts[item.recommendation] || 0) + 1;
  const tabsEl = $('#tabs');
  tabsEl.innerHTML = '';
  for (const key of TAB_ORDER) {
    if (!counts[key]) continue;
    const btn = document.createElement('button');
    btn.className = 'tab'; btn.dataset.tab = key;
    btn.innerHTML = `${t(TAB_LABELS[key])} <span class="badge">${counts[key]}</span>`;
    btn.addEventListener('click', () => switchTab(key));
    tabsEl.appendChild(btn);
  }
}

function switchTab(tab) {
  currentTab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  renderTable();
  updateSelectedCount();
}

// ── Table rendering ──

function renderTable() {
  const tbody = $('#tbody');
  const filter = ($('#filter').value || '').toLowerCase();
  const items = allItems.filter((item) => {
    if (item.recommendation !== currentTab) return false;
    if (filter) {
      const hay = `${item.bookmark.title} ${item.bookmark.url} ${item.folderPath}`.toLowerCase();
      if (!hay.includes(filter)) return false;
    }
    return true;
  });

  tbody.innerHTML = '';
  for (const item of items) {
    const tr = document.createElement('tr');
    if (item.managed) tr.className = 'managed';
    const syncLabel = item.syncing === true ? t('review.sync') : item.syncing === false ? t('review.local') : t('review.unknown');
    const recClass = TAG_CLASS[item.recommendation] || 'tag-keep';

    tr.innerHTML = `
      <td><input type="checkbox" data-id="${escapeHTML(item.bookmark.id)}" ${item.selected ? 'checked' : ''} ${item.managed ? 'disabled' : ''}></td>
      <td title="${escapeHTML(item.bookmark.title)}">${escapeHTML(truncate(item.bookmark.title, 50))}</td>
      <td class="url-cell" title="${escapeHTML(item.bookmark.url)}">${escapeHTML(item.bookmark.url)}</td>
      <td class="folder-cell" title="${escapeHTML(item.folderPath)}">${escapeHTML(truncate(item.folderPath, 30))}</td>
      <td>${escapeHTML(item.tsv.classification || '')} · ${escapeHTML(syncLabel)}</td>
      <td><span class="tag ${recClass}">${escapeHTML(item.recommendation)}</span></td>`;

    const cb = tr.querySelector('input[type="checkbox"]');
    cb.addEventListener('change', () => { item.selected = cb.checked; updateSelectedCount(); });
    tbody.appendChild(tr);
  }
}

function updateSelectedCount() {
  const count = allItems.filter((i) => i.recommendation === currentTab && i.selected).length;
  const total = allItems.filter((i) => i.recommendation === currentTab).length;
  $('#selected-count').textContent = t('review.selected_count', { count, total });
  $('#select-all').checked = count === total && total > 0;
}

// ── Controls ──

function bindControls() {
  $('#select-all').addEventListener('change', (e) => {
    const checked = e.target.checked;
    const filter = ($('#filter').value || '').toLowerCase();
    for (const item of allItems) {
      if (item.recommendation !== currentTab || item.managed) continue;
      if (checked && item.syncing !== true) continue;
      if (checked && item.recommendation === 'review') continue;
      if (filter) {
        const hay = `${item.bookmark.title} ${item.bookmark.url} ${item.folderPath}`.toLowerCase();
        if (!hay.includes(filter)) continue;
      }
      item.selected = checked;
    }
    renderTable();
    updateSelectedCount();
  });

  let filterTimer;
  $('#filter').addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { renderTable(); updateSelectedCount(); }, 200);
  });

  $('#btn-exec').addEventListener('click', executeSelected);
}

// ── Execution engine ──

async function executeSelected() {
  if (executing) return;

  const selected = allItems.filter((i) => i.selected && !i.managed && ACTIONABLE.has(i.recommendation));
  if (selected.length === 0) {
    alert(t('review.no_actionable'));
    return;
  }

  const upgradeCount = selected.filter((i) => i.recommendation === 'upgrade_https').length;
  const deleteCount = selected.filter((i) => i.recommendation === 'delete').length;
  const reviewCount = selected.filter((i) => i.recommendation === 'review').length;

  let confirmMsg = t('review.confirm_execute', { total: selected.length, upgrade: upgradeCount, delete: deleteCount });
  if (reviewCount > 0) confirmMsg += t('review.confirm_review_count', { count: reviewCount });
  confirmMsg += t('review.confirm_undo');
  if (!confirm(confirmMsg)) return;

  if (reviewCount > 0) {
    if (!confirm(t('review.confirm_review_warning', { count: reviewCount }))) return;
  }

  const lockCheck = await chrome.storage.local.get(['pending_changelog', 'pending_restore_journal', 'executing_batch']);
  if (lockCheck.pending_changelog || lockCheck.pending_restore_journal || lockCheck.executing_batch) {
    alert(t('review.lock_error'));
    return;
  }

  executing = true;
  const btn = $('#btn-exec'); btn.disabled = true;
  const bar = $('#progress-bar');
  const summary = $('#summary');
  summary.textContent = t('review.executing');

  const changeLog = selected.map((item) => {
    const action = item.recommendation === 'upgrade_https' ? 'upgrade' : 'delete';
    const newUrl = action === 'upgrade' ? item.tsv.https_url : null;

    if (action === 'upgrade' && newUrl) {
      try {
        const parsed = new URL(newUrl);
        if (parsed.protocol !== 'https:') {
          return { action, id: item.bookmark.id, parentId: item.bookmark.parentId, index: item.bookmark.index, title: item.bookmark.title, oldUrl: item.bookmark.url, newUrl, status: 'skipped', error: `target URL is not https: ${parsed.protocol}` };
        }
      } catch {
        return { action, id: item.bookmark.id, parentId: item.bookmark.parentId, index: item.bookmark.index, title: item.bookmark.title, oldUrl: item.bookmark.url, newUrl, status: 'skipped', error: `invalid target URL: ${newUrl}` };
      }
    }

    return { action, id: item.bookmark.id, parentId: item.bookmark.parentId, index: item.bookmark.index, title: item.bookmark.title, oldUrl: item.bookmark.url, newUrl, status: 'pending', error: null };
  });

  try {
    await chrome.storage.local.set({ pending_changelog: changeLog, executing_batch: { batchId: batchId || 'exec', since: Date.now() } });
  } catch (e) {
    summary.textContent = t('review.changelog_error', { message: e.message });
    summary.className = 'summary error'; btn.disabled = false; executing = false; return;
  }

  let done = 0, ok = 0, fail = 0, journalStale = false;

  for (const entry of changeLog) {
    if (entry.status !== 'pending') { done++; bar.style.width = `${(done / changeLog.length) * 100}%`; continue; }

    try {
      const current = await chrome.bookmarks.get(entry.id);
      if (!current || current.length === 0) {
        entry.status = 'skipped'; entry.error = 'bookmark no longer exists';
        done++; bar.style.width = `${(done / changeLog.length) * 100}%`;
        journalStale = !(await persistJournal('pending_changelog', changeLog)) || journalStale; continue;
      }
      const bm = current[0];
      if (bm.url !== entry.oldUrl) {
        entry.status = 'skipped'; entry.error = `URL changed since scan`;
        done++; bar.style.width = `${(done / changeLog.length) * 100}%`;
        journalStale = !(await persistJournal('pending_changelog', changeLog)) || journalStale; continue;
      }
      entry.parentId = bm.parentId; entry.index = bm.index; entry.title = bm.title;
    } catch (e) {
      entry.status = 'skipped'; entry.error = `pre-check failed: ${e.message}`;
      done++; bar.style.width = `${(done / changeLog.length) * 100}%`;
      journalStale = !(await persistJournal('pending_changelog', changeLog)) || journalStale; continue;
    }

    try {
      if (entry.action === 'upgrade' && entry.newUrl) { await chrome.bookmarks.update(entry.id, { url: entry.newUrl }); entry.status = 'ok'; }
      else if (entry.action === 'delete') { await chrome.bookmarks.remove(entry.id); entry.status = 'ok'; }
      else { entry.status = 'skipped'; entry.error = 'unsupported action'; }
      if (entry.status === 'ok') ok++;
    } catch (e) { entry.status = 'error'; entry.error = e.message; fail++; }

    done++; bar.style.width = `${(done / changeLog.length) * 100}%`;
    journalStale = !(await persistJournal('pending_changelog', changeLog)) || journalStale;
    if (done % 10 === 0) await yieldUI();
  }

  summary.textContent = t('review.saving_log');
  const logBlob = new Blob([JSON.stringify(changeLog, null, 2)], { type: 'application/json' });
  const logUrl = URL.createObjectURL(logBlob);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const downloadSaved = await waitForDownload(logUrl, `bookmark-changes-${ts}.json`);
  URL.revokeObjectURL(logUrl);

  if (downloadSaved) {
    await chrome.storage.local.remove(['pending_changelog', 'executing_batch']).catch(() => {});
  } else {
    await chrome.storage.local.remove('executing_batch').catch(() => {});
    let msg = t('review.done_download_failed', { ok, fail });
    if (journalStale) msg += t('review.journal_stale_also');
    summary.textContent = msg; summary.className = 'summary error';
    buildTabs(); renderTable(); updateSelectedCount(); btn.disabled = false; executing = false; return;
  }

  const executedIds = new Set(changeLog.filter((e) => e.status === 'ok').map((e) => e.id));
  allItems = allItems.filter((i) => !executedIds.has(i.bookmark.id));

  const skipped = changeLog.filter((e) => e.status === 'skipped').length;
  let msg = t('review.done', { ok, fail, skipped });
  if (journalStale) msg += t('review.journal_stale');
  summary.textContent = msg;
  summary.className = (fail > 0 || journalStale) ? 'summary error' : 'summary';

  buildTabs(); renderTable(); updateSelectedCount(); btn.disabled = false; executing = false;
}

// ── Journal persistence with heartbeat ──

async function persistJournal(key, data) {
  try {
    await chrome.storage.local.set({ [key]: data, executing_batch: { batchId: batchId || 'active', since: Date.now() } });
    return true;
  } catch (e) { console.error('Journal persist failed:', e); return false; }
}

// ── Download helper ──

function waitForDownload(blobUrl, filename) {
  return new Promise(async (resolve) => {
    let downloadId;
    const timeout = setTimeout(() => { chrome.downloads.onChanged.removeListener(listener); resolve(false); }, 30000);
    function listener(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state) {
        if (delta.state.current === 'complete') { clearTimeout(timeout); chrome.downloads.onChanged.removeListener(listener); resolve(true); }
        else if (delta.state.current === 'interrupted') { clearTimeout(timeout); chrome.downloads.onChanged.removeListener(listener); resolve(false); }
      }
    }
    chrome.downloads.onChanged.addListener(listener);
    try { downloadId = await chrome.downloads.download({ url: blobUrl, filename, saveAs: true }); }
    catch (e) { clearTimeout(timeout); chrome.downloads.onChanged.removeListener(listener); resolve(false); }
  });
}

// ── Helpers ──

function escapeHTML(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? s.slice(0, len) + '…' : s;
}

function yieldUI() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
