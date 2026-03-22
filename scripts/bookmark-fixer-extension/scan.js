/* scan.js — scan flow controller: reads bookmarks, runs checker, shows progress */

const $ = (sel) => document.querySelector(sel);

const stats = { alive: 0, dead: 0, uncertain: 0, skipped: 0 };
let scanStartTime = 0;
let cancelled = false;

(async () => {
  // 1. Read all bookmarks
  $('h1').textContent = 'Reading bookmarks…';
  const tree = await chrome.bookmarks.getTree();
  const folderPaths = buildFolderPaths(tree);
  const nodes = flattenToCheckable(tree, folderPaths);

  $('#stat-total').textContent = nodes.length;
  $('h1').textContent = `Scanning ${nodes.length} bookmarks…`;

  if (nodes.length === 0) {
    $('h1').textContent = 'No bookmarks to scan.';
    return;
  }

  // 2. Set up cancellation
  const abortController = new AbortController();
  $('#btn-cancel').addEventListener('click', () => {
    cancelled = true;
    abortController.abort();
    $('#btn-cancel').disabled = true;
    $('#btn-cancel').textContent = 'Cancelling…';
  });

  // 3. Run scan
  scanStartTime = Date.now();
  const results = await scanBookmarks(nodes, onProgress, abortController.signal);

  // 4. Done
  $('#btn-cancel').style.display = 'none';
  const summaryEl = $('#summary');
  summaryEl.style.display = '';

  if (cancelled) {
    $('h1').textContent = 'Scan cancelled';
    const actualResults = results.filter((r) => r.classification !== 'skipped' || !r.reason || r.reason !== 'cancelled');
    if (actualResults.length > 0) {
      summaryEl.className = 'summary partial';
      summaryEl.textContent = `Partial scan: ${actualResults.length} of ${nodes.length} checked in ${formatTime(Date.now() - scanStartTime)}.`;
      showReviewButton(actualResults);
    } else {
      summaryEl.textContent = `Scan cancelled after ${formatTime(Date.now() - scanStartTime)} — no results.`;
    }
  } else {
    $('h1').textContent = 'Scan complete';
    const actionable = results.filter((r) => r.recommendation !== 'keep');
    summaryEl.textContent = `Scanned ${results.length} bookmarks in ${formatTime(Date.now() - scanStartTime)}. ${actionable.length} need attention (${stats.dead} dead, ${stats.uncertain} uncertain, ${results.filter((r) => r.recommendation === 'upgrade_https').length} upgradable).`;
    showReviewButton(results);
  }
})();

function onProgress(completed, total, result) {
  // Update stats
  if (result.classification in stats) stats[result.classification]++;
  $('#stat-alive').textContent = stats.alive;
  $('#stat-dead').textContent = stats.dead;
  $('#stat-uncertain').textContent = stats.uncertain;
  $('#stat-skipped').textContent = stats.skipped;

  // Update progress bar
  const pct = ((completed / total) * 100).toFixed(1);
  $('#progress-bar').style.width = `${pct}%`;
  $('#progress-count').textContent = `${completed} / ${total}`;

  // Elapsed / ETA
  const elapsed = Date.now() - scanStartTime;
  $('#progress-elapsed').textContent = `${formatTime(elapsed)} elapsed`;
  if (completed > 10) {
    const rate = elapsed / completed;
    const remaining = (total - completed) * rate;
    $('#progress-eta').textContent = `~${formatTime(remaining)} remaining`;
  } else {
    $('#progress-eta').textContent = 'Estimating…';
  }

  // Log entry
  const logEl = $('#log');
  const entry = document.createElement('div');
  entry.className = `log-entry ${result.classification}`;
  entry.textContent = `[${result.classification}] ${result.url} → ${result.reason}${result.recommendation === 'upgrade_https' ? ' (HTTPS upgradable)' : ''}`;
  logEl.appendChild(entry);
  // Auto-scroll, keep last 200 entries
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
    summaryEl.textContent = `Failed to save scan results: ${e.message}. Try scanning fewer bookmarks or clear extension storage.`;
    return;
  }

  const reviewUrl = chrome.runtime.getURL(`review.html?source=scan&batch=${bid}`);

  if (!cancelled) {
    // Auto-open review on full scan completion; no button needed
    chrome.tabs.create({ url: reviewUrl });
  } else {
    // Cancelled: show button for partial review (don't auto-open)
    const btn = $('#btn-review');
    btn.style.display = '';
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: reviewUrl });
      btn.disabled = true;
      btn.textContent = 'Opened';
    });
  }
}

// ── Tree utilities ──

function flattenToCheckable(tree, folderPaths) {
  const nodes = [];
  const seen = new Set();
  function walk(node) {
    if (node.url) {
      // Deduplicate by bookmark ID
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
