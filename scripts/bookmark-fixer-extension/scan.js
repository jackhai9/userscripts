/* scan.js — scan flow controller: reads bookmarks, runs checker, shows progress */

const $ = (sel) => document.querySelector(sel);

const stats = { alive: 0, dead: 0, uncertain: 0, skipped: 0 };
let scanStartTime = 0;
let cancelled = false;

(async () => {
  await initI18n();

  // 1. Read all bookmarks
  $('h1 span').textContent = t('scan.reading');
  const tree = await chrome.bookmarks.getTree();
  const folderPaths = buildFolderPaths(tree);
  const nodes = flattenToCheckable(tree, folderPaths);

  $('#stat-total').textContent = nodes.length;
  $('h1 span').textContent = t('scan.scanning', { count: nodes.length });

  if (nodes.length === 0) {
    $('h1 span').textContent = t('scan.no_bookmarks');
    return;
  }

  // 2. Set up cancellation
  const abortController = new AbortController();
  $('#btn-cancel').addEventListener('click', () => {
    cancelled = true;
    abortController.abort();
    $('#btn-cancel').disabled = true;
    $('#btn-cancel').textContent = t('common.cancelling');
  });

  // 3. Run scan
  scanStartTime = Date.now();
  const results = await scanBookmarks(nodes, onProgress, abortController.signal);

  // 4. Done
  $('#btn-cancel').style.display = 'none';
  const summaryEl = $('#summary');
  summaryEl.style.display = '';
  const elapsed = formatTime(Date.now() - scanStartTime);

  if (cancelled) {
    $('h1 span').textContent = t('scan.cancelled');
    const actualResults = results.filter((r) => r.classification !== 'skipped' || !r.reason || r.reason !== 'cancelled');
    if (actualResults.length > 0) {
      summaryEl.className = 'summary partial';
      summaryEl.textContent = t('scan.partial', { done: actualResults.length, total: nodes.length, time: elapsed });
      showReviewButton(actualResults);
    } else {
      summaryEl.textContent = t('scan.cancelled_no_results', { time: elapsed });
    }
  } else {
    $('h1 span').textContent = t('scan.complete');
    const actionable = results.filter((r) => r.recommendation !== 'keep');
    const upgradable = results.filter((r) => r.recommendation === 'upgrade_https').length;
    summaryEl.textContent = t('scan.summary', {
      total: results.length, time: elapsed, actionable: actionable.length,
      dead: stats.dead, uncertain: stats.uncertain, upgradable,
    });
    showReviewButton(results);
  }
})();

function onProgress(completed, total, result) {
  if (result.classification in stats) stats[result.classification]++;
  $('#stat-alive').textContent = stats.alive;
  $('#stat-dead').textContent = stats.dead;
  $('#stat-uncertain').textContent = stats.uncertain;
  $('#stat-skipped').textContent = stats.skipped;

  const pct = ((completed / total) * 100).toFixed(1);
  $('#progress-bar').style.width = `${pct}%`;
  $('#progress-count').textContent = `${completed} / ${total}`;

  const elapsed = Date.now() - scanStartTime;
  $('#progress-elapsed').textContent = t('scan.elapsed', { time: formatTime(elapsed) });
  if (completed > 10) {
    const rate = elapsed / completed;
    const remaining = (total - completed) * rate;
    $('#progress-eta').textContent = t('scan.remaining', { time: formatTime(remaining) });
  } else {
    $('#progress-eta').textContent = t('scan.estimating');
  }

  const logEl = $('#log');
  const entry = document.createElement('div');
  entry.className = `log-entry ${result.classification}`;
  const suffix = result.recommendation === 'upgrade_https' ? ' ' + t('scan.https_upgradable') : '';
  entry.textContent = `[${result.classification}] ${result.url} → ${result.reason}${suffix}`;
  logEl.appendChild(entry);
  if (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

async function showReviewButton(results) {
  const bid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await chrome.storage.local.set({ [`scan_data_${bid}`]: results });
  } catch (e) {
    const summaryEl = $('#summary');
    summaryEl.style.display = '';
    summaryEl.className = 'summary partial';
    summaryEl.textContent = t('scan.save_failed', { message: e.message });
    return;
  }

  const reviewUrl = chrome.runtime.getURL(`review.html?source=scan&batch=${bid}`);

  if (!cancelled) {
    chrome.tabs.create({ url: reviewUrl });
  } else {
    const btn = $('#btn-review');
    btn.style.display = '';
    btn.textContent = t('scan.open_review');
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: reviewUrl });
      btn.disabled = true;
      btn.textContent = t('scan.opened');
    });
  }
}

// ── Tree utilities ──

function flattenToCheckable(tree, folderPaths) {
  const nodes = [];
  const seen = new Set();
  function walk(node) {
    if (node.url) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        nodes.push({
          bookmarkId: node.id,
          parentId: node.parentId,
          index: node.index,
          title: node.title,
          folderPath: folderPaths.get(node.parentId) || '',
          syncing: node.syncing,
          unmodifiable: node.unmodifiable,
          url: node.url,
        });
      }
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  for (const root of tree) walk(root);
  return nodes;
}

function buildFolderPaths(tree) {
  const paths = new Map();
  function walk(node, path) {
    const currentPath = node.title ? (path ? `${path}/${node.title}` : node.title) : path;
    paths.set(node.id, currentPath);
    if (node.children) {
      for (const child of node.children) walk(child, currentPath);
    }
  }
  for (const root of tree) walk(root, '');
  return paths;
}

function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}
