/* i18n.js — lightweight i18n for bookmark-fixer-extension */

const I18N_MESSAGES = {
  en: {
    // ── Common ──
    'common.error': 'Error: {message}',
    'common.cancel': 'Cancel',
    'common.cancelling': 'Cancelling…',

    // ── Popup ──
    'popup.title': 'Bookmark Batch Fixer',
    'popup.interrupted': 'Interrupted execution detected',
    'popup.download_pending': 'Download pending change log',
    'popup.discard_pending': 'Discard pending log',
    'popup.backup_title': '1. Backup',
    'popup.backup_btn': 'Export bookmarks as HTML (disaster recovery)',
    'popup.scan_title': '2. Scan bookmarks',
    'popup.scan_btn': 'Scan all bookmarks for dead links & HTTPS upgrades',
    'popup.scan_desc': 'Checks all URLs directly from the browser — no external tools needed.',
    'popup.import_title': '3. Import check results (optional)',
    'popup.import_btn': 'Select bookmark_check_result.tsv',
    'popup.restore_title': '4. Restore from log',
    'popup.restore_btn': 'Select change log JSON to restore',
    'popup.exporting': 'Exporting…',
    'popup.backup_saved': 'Backup saved.',
    'popup.backup_failed': 'Backup download was cancelled or failed.',
    'popup.reading': 'Reading…',
    'popup.parsed_rows': 'Parsed {count} rows. Opening review page…',
    'popup.reading_log': 'Reading log…',
    'popup.loaded_entries': 'Loaded {count} entries. Opening restore page…',
    'popup.interrupted_status': 'Interrupted {label}: {executed} executed, {pending} pending.',
    'popup.also_restore': '(Also found an interrupted restore journal — handle this one first.)',
    'popup.download_failed': 'Download failed or cancelled. Log kept in storage.',
    'popup.discard_confirm': 'Discard the interrupted {label} log? You will lose the ability to undo already-executed operations.',
    'popup.missing_headers': 'Missing required TSV headers: {missing}. Got: {got}',
    'popup.label_execution': 'execution',
    'popup.label_restore': 'restore',

    // ── Scan ──
    'scan.page_title': 'Bookmark Batch Fixer — Scan',
    'scan.heading': 'Scanning Bookmarks…',
    'scan.total': 'Total bookmarks',
    'scan.alive': 'Alive',
    'scan.dead': 'Dead',
    'scan.uncertain': 'Uncertain',
    'scan.skipped': 'Skipped',
    'scan.estimating': 'Estimating…',
    'scan.elapsed': '{time} elapsed',
    'scan.remaining': '{time} remaining',
    'scan.open_review': 'Open Review',
    'scan.reading': 'Reading bookmarks…',
    'scan.scanning': 'Scanning {count} bookmarks…',
    'scan.no_bookmarks': 'No bookmarks to scan.',
    'scan.cancelled': 'Scan cancelled',
    'scan.complete': 'Scan complete',
    'scan.opened': 'Opened',
    'scan.partial': 'Partial scan: {done} of {total} checked in {time}.',
    'scan.cancelled_no_results': 'Scan cancelled after {time} — no results.',
    'scan.summary': 'Scanned {total} bookmarks in {time}. {actionable} need attention ({dead} dead, {uncertain} uncertain, {upgradable} upgradable).',
    'scan.https_upgradable': '(HTTPS upgradable)',
    'scan.save_failed': 'Failed to save scan results: {message}. Try scanning fewer bookmarks or clear extension storage.',

    // ── Review ──
    'review.page_title': 'Bookmark Batch Fixer — Review',
    'review.unmatched': '{count} bookmarks not found in Chrome (click to expand)',
    'review.unmatched_suffix': 'bookmarks not found in Chrome (click to expand)',
    'review.filter_placeholder': 'Filter by URL or title…',
    'review.select_all': 'Select all',
    'review.th_title': 'Title',
    'review.th_url': 'URL',
    'review.th_folder': 'Folder',
    'review.th_status': 'Status',
    'review.th_recommendation': 'Recommendation',
    'review.execute': 'Execute Selected',
    'review.selected_count': '{count}/{total} selected',
    'review.tab_upgrade': 'HTTPS Upgrade',
    'review.tab_delete': 'Delete',
    'review.tab_review': 'Uncertain',
    'review.tab_keep': 'Keep',
    'review.no_batch': 'No batch ID. Please import from popup.',
    'review.no_tsv': 'No TSV data. Please import from popup.',
    'review.matching': 'Matching {count} URLs with Chrome bookmarks…',
    'review.matched': 'Matched {matched} bookmarks ({unmatched} unmatched)',
    'review.no_scan_batch': 'No batch ID. Please scan from popup.',
    'review.no_scan_data': 'No scan data. Please scan from popup.',
    'review.loading_scan': 'Loading {count} scan results…',
    'review.bookmarks_to_review': '{count} bookmarks to review',
    'review.no_restore_log': 'No restore log. Please import from popup.',
    'review.no_valid_entries': 'No valid restore entries found.',
    'review.restore_title': 'Bookmark Batch Fixer — Restore',
    'review.restore_mode': 'Restore mode: {count} valid operations to undo.',
    'review.restore_skipped': 'Skipped: {missing} with missing fields, {badAction} with unknown action.',
    'review.restore_btn': 'Restore Selected',
    'review.undo_label': '{action} → undo',
    'review.restoring': 'Restoring… Do not close this tab.',
    'review.restore_complete': 'Restore complete: {ok} succeeded, {fail} failed, {skipped} skipped.',
    'review.restore_journal_warning': ' WARNING: Some journal writes failed — if this was interrupted, recovery data may be incomplete.',
    'review.restore_journal_error': 'Cannot save restore journal: {message}. Aborting.',
    'review.no_actionable': 'No actionable items selected. Only HTTPS Upgrade, Delete, and Review items can be executed.',
    'review.lock_error': 'Another execution or restore is still in progress (or was interrupted). Please recover or discard it from the popup first.',
    'review.confirm_execute': 'Execute {total} operations?\n\nUpgrade HTTPS: {upgrade}\nDelete (dead links): {delete}',
    'review.confirm_review_count': '\nDelete (uncertain/review): {count}',
    'review.confirm_undo': '\n\nA change log will be saved for undo.',
    'review.confirm_review_warning': 'WARNING: You are about to DELETE {count} bookmarks that were marked "review" (uncertain status — timeout, auth wall, redirect, etc.).\n\nThese may be FALSE POSITIVES. Are you sure you want to delete them?',
    'review.executing': 'Executing… Do not close this tab.',
    'review.saving_log': 'Saving change log… Do not close this tab.',
    'review.done': 'Done: {ok} succeeded, {fail} failed, {skipped} skipped. Change log saved.',
    'review.done_download_failed': 'Done: {ok} succeeded, {fail} failed. WARNING: Download may have failed — change log kept in extension storage. Use popup to recover.',
    'review.journal_stale': ' Note: Some journal writes failed during execution — recovery data may be incomplete if this was interrupted.',
    'review.journal_stale_also': ' ALSO: Some journal writes failed during execution.',
    'review.changelog_error': 'Cannot save change log: {message}. Aborting — no bookmarks were modified.',
    'review.sync': 'sync',
    'review.local': 'local',
    'review.unknown': 'unknown',

    // ── Language toggle ──
    'lang.toggle': 'EN | 中',
  },

  zh: {
    // ── Common ──
    'common.error': '错误：{message}',
    'common.cancel': '取消',
    'common.cancelling': '正在取消…',

    // ── Popup ──
    'popup.title': '书签批量修复',
    'popup.interrupted': '检测到中断的执行',
    'popup.download_pending': '下载中断的变更日志',
    'popup.discard_pending': '丢弃中断日志',
    'popup.backup_title': '1. 备份',
    'popup.backup_btn': '导出书签为 HTML（灾难恢复）',
    'popup.scan_title': '2. 扫描书签',
    'popup.scan_btn': '扫描所有书签：检测死链和 HTTPS 升级',
    'popup.scan_desc': '直接从浏览器检查所有 URL，无需外部工具。',
    'popup.import_title': '3. 导入检查结果（可选）',
    'popup.import_btn': '选择 bookmark_check_result.tsv',
    'popup.restore_title': '4. 从日志恢复',
    'popup.restore_btn': '选择变更日志 JSON 进行恢复',
    'popup.exporting': '正在导出…',
    'popup.backup_saved': '备份已保存。',
    'popup.backup_failed': '备份下载被取消或失败。',
    'popup.reading': '正在读取…',
    'popup.parsed_rows': '已解析 {count} 行。正在打开审查页面…',
    'popup.reading_log': '正在读取日志…',
    'popup.loaded_entries': '已加载 {count} 条记录。正在打开恢复页面…',
    'popup.interrupted_status': '中断的{label}：{executed} 条已执行，{pending} 条未完成。',
    'popup.also_restore': '（还发现了中断的恢复日志——请先处理此项。）',
    'popup.download_failed': '下载失败或取消。日志已保留在存储中。',
    'popup.discard_confirm': '丢弃中断的{label}日志？您将失去撤销已执行操作的能力。',
    'popup.missing_headers': '缺少必需的 TSV 表头：{missing}。实际：{got}',
    'popup.label_execution': '执行',
    'popup.label_restore': '恢复',

    // ── Scan ──
    'scan.page_title': '书签批量修复 — 扫描',
    'scan.heading': '正在扫描书签…',
    'scan.total': '总书签数',
    'scan.alive': '正常',
    'scan.dead': '死链',
    'scan.uncertain': '不确定',
    'scan.skipped': '已跳过',
    'scan.estimating': '估算中…',
    'scan.elapsed': '已用时 {time}',
    'scan.remaining': '预计剩余 {time}',
    'scan.open_review': '打开审查',
    'scan.reading': '正在读取书签…',
    'scan.scanning': '正在扫描 {count} 个书签…',
    'scan.no_bookmarks': '没有可扫描的书签。',
    'scan.cancelled': '扫描已取消',
    'scan.complete': '扫描完成',
    'scan.opened': '已打开',
    'scan.partial': '部分扫描：{total} 个中已检查 {done} 个，用时 {time}。',
    'scan.cancelled_no_results': '扫描在 {time} 后取消——无结果。',
    'scan.summary': '已扫描 {total} 个书签，用时 {time}。{actionable} 个需要处理（{dead} 个死链，{uncertain} 个不确定，{upgradable} 个可升级）。',
    'scan.https_upgradable': '（可升级 HTTPS）',
    'scan.save_failed': '保存扫描结果失败：{message}。请尝试扫描更少的书签或清理扩展存储。',

    // ── Review ──
    'review.page_title': '书签批量修复 — 审查',
    'review.unmatched': '{count} 个书签在 Chrome 中未找到（点击展开）',
    'review.filter_placeholder': '按 URL 或标题筛选…',
    'review.select_all': '全选',
    'review.th_title': '标题',
    'review.th_url': 'URL',
    'review.th_folder': '文件夹',
    'review.th_status': '状态',
    'review.th_recommendation': '建议',
    'review.execute': '执行所选',
    'review.selected_count': '{count}/{total} 已选',
    'review.tab_upgrade': 'HTTPS 升级',
    'review.tab_delete': '删除',
    'review.tab_review': '待定',
    'review.tab_keep': '保留',
    'review.no_batch': '无批次 ID。请从弹窗导入。',
    'review.no_tsv': '无 TSV 数据。请从弹窗导入。',
    'review.matching': '正在匹配 {count} 个 URL 与 Chrome 书签…',
    'review.matched': '已匹配 {matched} 个书签（{unmatched} 个未匹配）',
    'review.no_scan_batch': '无批次 ID。请从弹窗扫描。',
    'review.no_scan_data': '无扫描数据。请从弹窗扫描。',
    'review.loading_scan': '正在加载 {count} 条扫描结果…',
    'review.bookmarks_to_review': '{count} 个书签待处理',
    'review.no_restore_log': '无恢复日志。请从弹窗导入。',
    'review.no_valid_entries': '未找到有效的恢复条目。',
    'review.restore_title': '书签批量修复 — 恢复',
    'review.restore_mode': '恢复模式：{count} 个有效操作可撤销。',
    'review.restore_skipped': '已跳过：{missing} 个缺少字段，{badAction} 个操作类型未知。',
    'review.restore_btn': '恢复所选',
    'review.undo_label': '{action} → 撤销',
    'review.restoring': '正在恢复…请不要关闭此标签页。',
    'review.restore_complete': '恢复完成：{ok} 成功，{fail} 失败，{skipped} 跳过。',
    'review.restore_journal_warning': ' 警告：部分日志写入失败——如果中断，恢复数据可能不完整。',
    'review.restore_journal_error': '无法保存恢复日志：{message}。已中止。',
    'review.no_actionable': '未选择可执行的项。只有 HTTPS 升级、删除和审查项可以执行。',
    'review.lock_error': '另一个执行或恢复仍在进行中（或已中断）。请先从弹窗中恢复或丢弃。',
    'review.confirm_execute': '执行 {total} 个操作？\n\n升级 HTTPS：{upgrade}\n删除（死链）：{delete}',
    'review.confirm_review_count': '\n删除（不确定/审查）：{count}',
    'review.confirm_undo': '\n\n变更日志将被保存以供撤销。',
    'review.confirm_review_warning': '警告：您即将删除 {count} 个标记为"审查"的书签（不确定状态——超时、认证墙、重定向等）。\n\n这些可能是误判。确定要删除吗？',
    'review.executing': '正在执行…请不要关闭此标签页。',
    'review.saving_log': '正在保存变更日志…请不要关闭此标签页。',
    'review.done': '完成：{ok} 成功，{fail} 失败，{skipped} 跳过。变更日志已保存。',
    'review.done_download_failed': '完成：{ok} 成功，{fail} 失败。警告：下载可能失败——变更日志已保留在扩展存储中。请从弹窗恢复。',
    'review.journal_stale': ' 注意：执行期间部分日志写入失败——如果中断，恢复数据可能不完整。',
    'review.journal_stale_also': ' 另外：执行期间部分日志写入失败。',
    'review.changelog_error': '无法保存变更日志：{message}。已中止——未修改任何书签。',
    'review.sync': '同步',
    'review.local': '本地',
    'review.unknown': '未知',

    // ── Language toggle ──
    'lang.toggle': 'EN | 中',
  },
};

let currentLang = 'en';

/**
 * Translate a key with optional parameter substitution.
 * t('scan.partial', {done: 10, total: 100}) → "Partial scan: 10 of 100 checked…"
 */
function t(key, params) {
  let msg = (I18N_MESSAGES[currentLang] && I18N_MESSAGES[currentLang][key])
    || (I18N_MESSAGES.en && I18N_MESSAGES.en[key])
    || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return msg;
}

/**
 * Apply translations to all tagged elements in the page.
 */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  const titleKey = document.documentElement.dataset.i18nTitle;
  if (titleKey) document.title = t(titleKey);

  // Update toggle button text
  const toggleBtn = document.getElementById('lang-toggle');
  if (toggleBtn) toggleBtn.textContent = currentLang === 'en' ? '中文' : 'English';
}

/**
 * Switch language, update page, persist choice.
 */
async function setLang(lang) {
  currentLang = lang;
  applyI18n();
  try {
    await chrome.storage.local.set({ i18n_lang: lang });
  } catch { /* ignore storage errors for lang preference */ }
}

/**
 * Initialize i18n: read stored preference or detect from browser.
 * Must be awaited before any UI rendering.
 */
async function initI18n() {
  try {
    const stored = await chrome.storage.local.get('i18n_lang');
    if (stored.i18n_lang && I18N_MESSAGES[stored.i18n_lang]) {
      currentLang = stored.i18n_lang;
    } else {
      currentLang = navigator.language.startsWith('zh') ? 'zh' : 'en';
    }
  } catch {
    currentLang = navigator.language.startsWith('zh') ? 'zh' : 'en';
  }
  applyI18n();
  setupLangToggle();
}

/**
 * Add language toggle button behavior.
 */
function setupLangToggle() {
  const btn = document.getElementById('lang-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    setLang(currentLang === 'en' ? 'zh' : 'en');
  });
}
