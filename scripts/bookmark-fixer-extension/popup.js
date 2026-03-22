/* popup.js — entry point: backup, TSV import, restore */

const $ = (sel) => document.querySelector(sel);

// ── Backup: export bookmarks as Netscape HTML ──

$('#btn-backup').addEventListener('click', async () => {
  const status = $('#backup-status');
  status.textContent = 'Exporting…';
  status.className = 'status';
  try {
    const tree = await chrome.bookmarks.getTree();
    const html = treeToNetscapeHTML(tree);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().slice(0, 10);
    const saved = await waitForDownload(url, `bookmarks-backup-${ts}.html`);
    URL.revokeObjectURL(url);
    if (saved) {
      status.textContent = 'Backup saved.';
      status.className = 'status success';
    } else {
      status.textContent = 'Backup download was cancelled or failed.';
      status.className = 'status error';
    }
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    status.className = 'status error';
  }
});

function treeToNetscapeHTML(nodes) {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  function walk(children, depth) {
    const indent = '    '.repeat(depth);
    for (const node of children) {
      if (node.url) {
        const add = node.dateAdded ? ` ADD_DATE="${Math.floor(node.dateAdded / 1000)}"` : '';
        lines.push(`${indent}<DT><A HREF="${escapeHTML(node.url)}"${add}>${escapeHTML(node.title)}</A>`);
      } else if (node.children) {
        lines.push(`${indent}<DT><H3>${escapeHTML(node.title)}</H3>`);
        lines.push(`${indent}<DL><p>`);
        walk(node.children, depth + 1);
        lines.push(`${indent}</DL><p>`);
      }
    }
  }
  if (nodes[0] && nodes[0].children) walk(nodes[0].children, 1);
  lines.push('</DL><p>');
  return lines.join('\n');
}

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Scan bookmarks ──

$('#btn-scan').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('scan.html') });
});

// ── Import TSV → open review page ──

$('#btn-import').addEventListener('click', () => $('#file-input').click());

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = $('#import-status');
  status.textContent = 'Reading…';
  status.className = 'status';
  try {
    const text = await file.text();
    const rows = parseTSV(text);
    status.textContent = `Parsed ${rows.length} rows. Opening review page…`;
    status.className = 'status success';
    const bid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await chrome.storage.local.set({ [`tsv_data_${bid}`]: rows });
    chrome.tabs.create({ url: chrome.runtime.getURL(`review.html?batch=${bid}`) });
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'status error';
  }
});

function parseTSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map((h) => h.trim());
  // Validate required headers
  const required = ['url', 'recommendation'];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new Error(`Missing required TSV headers: ${missing.join(', ')}. Got: ${headers.join(', ')}`);
  }
  return lines.slice(1).map((line) => {
    const vals = line.split('\t');
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (vals[i] || '').trim()));
    return obj;
  });
}

// ── Restore from change log JSON ──

$('#btn-restore').addEventListener('click', () => $('#restore-input').click());

$('#restore-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = $('#restore-status');
  status.textContent = 'Reading log…';
  status.className = 'status';
  try {
    const log = JSON.parse(await file.text());
    if (!Array.isArray(log) || log.length === 0) throw new Error('Empty or invalid log');
    const bid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await chrome.storage.local.set({ [`restore_log_${bid}`]: log });
    chrome.tabs.create({ url: chrome.runtime.getURL(`review.html?mode=restore&batch=${bid}`) });
    status.textContent = `Loaded ${log.length} entries. Opening restore page…`;
    status.className = 'status success';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    status.className = 'status error';
  }
});

// ── Detect interrupted execution (pending_changelog OR pending_restore_journal) ──

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

(async () => {
  const stored = await chrome.storage.local.get(['pending_changelog', 'pending_restore_journal', 'executing_batch']);

  const execInfo = stored.executing_batch; // {batchId, since} or falsy
  const changelog = stored.pending_changelog;
  const restoreJournal = stored.pending_restore_journal;

  if (!changelog && !restoreJournal) return;

  // If a batch is actively executing and not stale, don't show recovery UI
  if (execInfo && typeof execInfo === 'object' && execInfo.since) {
    const age = Date.now() - execInfo.since;
    if (age < STALE_THRESHOLD_MS) return; // still active, don't interfere
    // Stale — clear the flag and fall through to show recovery
    await chrome.storage.local.remove('executing_batch').catch(() => {});
  }

  const section = $('#pending-section');
  section.style.display = '';

  // If both journals exist, prioritize changelog (more destructive); mention both
  const log = changelog || restoreJournal;
  const journalKey = changelog ? 'pending_changelog' : 'pending_restore_journal';
  const label = changelog ? 'execution' : 'restore';
  const bothExist = changelog && restoreJournal;

  const executed = log.filter((e) => {
    const s = e.status || e.restoreStatus;
    return s === 'ok' || s === 'error';
  });
  const pending = log.filter((e) => {
    const s = e.status || e.restoreStatus;
    return s === 'pending';
  });
  let statusMsg = `Interrupted ${label}: ${executed.length} executed, ${pending.length} pending.`;
  if (bothExist) statusMsg += ' (Also found an interrupted restore journal — handle this one first.)';
  $('#pending-status').textContent = statusMsg;
  $('#pending-status').className = 'status error';

  $('#btn-download-pending').addEventListener('click', async () => {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const saved = await waitForDownload(url, `bookmark-changes-interrupted-${ts}.json`);
    URL.revokeObjectURL(url);
    if (saved) {
      await chrome.storage.local.remove(journalKey);
      section.style.display = 'none';
    } else {
      $('#pending-status').textContent = 'Download failed or cancelled. Log kept in storage.';
    }
  });

  $('#btn-discard-pending').addEventListener('click', async () => {
    if (!confirm(`Discard the interrupted ${label} log? You will lose the ability to undo already-executed operations.`)) return;
    await chrome.storage.local.remove(journalKey);
    section.style.display = 'none';
  });
})();

// ── Wait for download to reach 'complete' state ──

function waitForDownload(blobUrl, filename) {
  return new Promise(async (resolve) => {
    let downloadId;
    const timeout = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      resolve(false);
    }, 30000);

    function listener(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state) {
        if (delta.state.current === 'complete') {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(listener);
          resolve(true);
        } else if (delta.state.current === 'interrupted') {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(listener);
          resolve(false);
        }
      }
    }

    chrome.downloads.onChanged.addListener(listener);
    try {
      downloadId = await chrome.downloads.download({ url: blobUrl, filename, saveAs: true });
    } catch (e) {
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(listener);
      resolve(false);
    }
  });
}
