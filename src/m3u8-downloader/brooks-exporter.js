import {
  BROOKS_MEDIA_EXPORT_SCHEMA_VERSION,
  BROOKS_MEDIA_EXPORT_STATUS_INTERVAL_MS,
  BROOKS_MEDIA_EXPORT_STEP_DELAY_MS,
  BROOKS_MEDIA_EXPORT_TIMEOUT_MS,
  BROOKS_MEDIA_INDEX_MESSAGE_TYPE,
  BROOKS_MEDIA_INDEX_STATE_KEY,
} from './constants.js'
import {
  buildBrooksMediaExportEmbedUrl,
  extractBrooksMediaExportPageInfo,
  getBrooksCourseVideoLinks,
  isBrooksCourseIndexPage,
  isBrooksHost,
  isSameBrooksVideoPage,
} from './brooks-pages.js'
import { buildBrooksMediaIndexRecord } from './brooks-record.js'
import {
  buildBrooksMediaExportPayload,
  canRetryFailedBrooksMediaExport,
  formatBrooksMediaExportStatus,
  getBrooksMediaExportPrimaryLabel,
  markBrooksMediaExportRunStarted,
  shouldShowBrooksMediaExportReset,
  stopBrooksMediaExportRunTimer,
} from './brooks-status.js'

export function createBrooksMediaExporter({ originXHR, downloadWithA, getTitle }) {
  var brooksMediaExportState = null
  var brooksMediaExportFrame = null
  var brooksMediaExportPending = null

  function notifyBrooksMediaIndexDetected(url, referer) {
    if (!isBrooksHost(location.hostname)) {
      return
    }
    try {
      const record = buildBrooksMediaIndexRecord({
        pageUrl: location.href,
        title: getTitle(),
        referer,
        m3u8Url: url,
      })
      window.top.postMessage({
        type: BROOKS_MEDIA_INDEX_MESSAGE_TYPE,
        record,
      }, location.origin)
    } catch (error) {
      console.error('Unable to build Brooks media index record:', error)
    }
  }

  function recordBrooksMediaExportSuccess(record) {
    if (!brooksMediaExportState || !brooksMediaExportPending) {
      return
    }
    if (!isSameBrooksVideoPage(record.pageUrl, brooksMediaExportPending.url)) {
      return
    }
    brooksMediaExportState.records.push({
      ...record,
      index: brooksMediaExportPending.index,
      url: brooksMediaExportPending.url,
      pageUrl: record.pageUrl,
    })
    advanceBrooksMediaExportQueue(brooksMediaExportPending.index)
    saveBrooksMediaExportState()
    clearBrooksMediaExportFrame()
    updateBrooksMediaExportStatus()
    setTimeout(processNextBrooksMediaExport, BROOKS_MEDIA_EXPORT_STEP_DELAY_MS)
  }

  function isBrooksMediaExportFrameMessage(event, data) {
    return !!(
      brooksMediaExportPending &&
      brooksMediaExportFrame &&
      event.source === brooksMediaExportFrame.contentWindow &&
      data &&
      data.brooksExport &&
      data.brooksExport.pageUrl &&
      isSameBrooksVideoPage(data.brooksExport.pageUrl, brooksMediaExportPending.url)
    )
  }

  function handleBrooksDirectM3u8Message(event, data) {
    if (!isBrooksMediaExportFrameMessage(event, data)) {
      return false
    }
    const record = buildBrooksMediaIndexRecord({
      pageUrl: data.brooksExport.pageUrl,
      title: data.brooksExport.title || '',
      referer: data.referer || '',
      m3u8Url: data.url,
    })
    recordBrooksMediaExportSuccess(record)
    return true
  }

  function saveBrooksMediaExportState() {
    if (!brooksMediaExportState) {
      return
    }
    brooksMediaExportState.updatedAt = new Date().toISOString()
    localStorage.setItem(BROOKS_MEDIA_INDEX_STATE_KEY, JSON.stringify(brooksMediaExportState))
  }

  function loadBrooksMediaExportState() {
    try {
      const raw = localStorage.getItem(BROOKS_MEDIA_INDEX_STATE_KEY)
      const state = raw ? JSON.parse(raw) : null
      return state && state.schemaVersion === BROOKS_MEDIA_EXPORT_SCHEMA_VERSION ? state : null
    } catch (error) {
      console.error('Unable to load Brooks media export state:', error)
      return null
    }
  }

  function updateBrooksMediaExportControls(state) {
    const primaryButton = document.getElementById('brooks-media-export-primary')
    if (primaryButton) {
      primaryButton.textContent = getBrooksMediaExportPrimaryLabel(state)
    }
    const retryFailedButton = document.getElementById('brooks-media-export-retry-failed')
    if (retryFailedButton) {
      const canRetryFailures = canRetryFailedBrooksMediaExport(state)
      retryFailedButton.style.display = canRetryFailures ? '' : 'none'
    }
    const resetButton = document.getElementById('brooks-media-export-reset')
    const resetHelp = document.getElementById('brooks-media-export-reset-help')
    const showReset = shouldShowBrooksMediaExportReset(state)
    if (resetButton) {
      resetButton.style.display = showReset ? '' : 'none'
      resetButton.title = '清空当前进度和结果，不会自动开始'
    }
    if (resetHelp) {
      resetHelp.style.display = showReset ? '' : 'none'
    }
  }

  function updateBrooksMediaExportStatus() {
    const statusEl = document.getElementById('brooks-media-export-status')
    if (!statusEl) {
      return
    }
    const state = brooksMediaExportState || loadBrooksMediaExportState()
    if (!state) {
      statusEl.textContent = `发现 ${getBrooksCourseVideoLinks(document).length} 个课程视频`
      updateBrooksMediaExportControls(null)
      return
    }
    statusEl.textContent = formatBrooksMediaExportStatus({
      state,
      pending: brooksMediaExportPending,
      now: Date.now(),
    })
    updateBrooksMediaExportControls(state)
  }

  function clearBrooksMediaExportFrame() {
    if (brooksMediaExportPending && brooksMediaExportPending.timeoutId) {
      clearTimeout(brooksMediaExportPending.timeoutId)
    }
    if (brooksMediaExportPending && brooksMediaExportPending.statusIntervalId) {
      clearInterval(brooksMediaExportPending.statusIntervalId)
    }
    brooksMediaExportPending = null
    if (brooksMediaExportFrame && brooksMediaExportFrame.parentNode) {
      brooksMediaExportFrame.remove()
    }
    brooksMediaExportFrame = null
  }

  function recordBrooksMediaExportFailure(index, url, error) {
    if (!brooksMediaExportState) {
      return
    }
    brooksMediaExportState.failures.push({
      ok: false,
      index,
      url,
      error,
    })
    advanceBrooksMediaExportQueue(index)
    saveBrooksMediaExportState()
    updateBrooksMediaExportStatus()
  }

  function getNextBrooksMediaExportIndex(state) {
    if (state && state.retryQueue && state.retryQueue.length) {
      return state.retryQueue[0]
    }
    return state && typeof state.index === 'number' ? state.index : 0
  }

  function advanceBrooksMediaExportQueue(index) {
    if (!brooksMediaExportState) {
      return
    }
    if (brooksMediaExportState.retryQueue && brooksMediaExportState.retryQueue.length) {
      brooksMediaExportState.retryQueue = brooksMediaExportState.retryQueue.filter(itemIndex => itemIndex !== index)
      if (!brooksMediaExportState.retryQueue.length) {
        delete brooksMediaExportState.retryQueue
      }
      return
    }
    brooksMediaExportState.index = index + 1
  }

  function isCurrentBrooksMediaExportPending(index, url) {
    return !!(
      brooksMediaExportState &&
      brooksMediaExportState.running &&
      !brooksMediaExportState.stopped &&
      brooksMediaExportPending &&
      brooksMediaExportPending.index === index &&
      isSameBrooksVideoPage(brooksMediaExportPending.url, url)
    )
  }

  function fetchBrooksMediaExportPageInfo(url, onSuccess, onFailure) {
    const xhr = new originXHR()
    xhr.open('GET', url, true)
    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) {
        onFailure(`page fetch failed: ${xhr.status}`)
        return
      }
      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(xhr.responseText || xhr.response || '', 'text/html')
        onSuccess(extractBrooksMediaExportPageInfo(doc, url))
      } catch (error) {
        onFailure(error && error.message ? error.message : 'page parse failed')
      }
    }
    xhr.onerror = function () {
      onFailure('page fetch network error')
    }
    xhr.send()
  }

  function createBrooksMediaExportFrame(src) {
    brooksMediaExportFrame = document.createElement('iframe')
    brooksMediaExportFrame.style.cssText = 'position:fixed;right:20px;top:20px;width:640px;height:360px;opacity:.01;pointer-events:none;border:0;z-index:9998;background:white;'
    brooksMediaExportFrame.setAttribute('aria-hidden', 'true')
    brooksMediaExportFrame.src = src
    document.body.appendChild(brooksMediaExportFrame)
  }

  function processNextBrooksMediaExport() {
    if (!brooksMediaExportState || !brooksMediaExportState.running || brooksMediaExportState.stopped) {
      updateBrooksMediaExportStatus()
      return
    }
    const index = getNextBrooksMediaExportIndex(brooksMediaExportState)
    const url = brooksMediaExportState.links[index]
    if (!url) {
      stopBrooksMediaExportRunTimer(brooksMediaExportState)
      brooksMediaExportState.running = false
      saveBrooksMediaExportState()
      clearBrooksMediaExportFrame()
      updateBrooksMediaExportStatus()
      return
    }

    clearBrooksMediaExportFrame()
    brooksMediaExportPending = {
      index,
      url,
      startedAt: Date.now(),
      timeoutId: setTimeout(() => {
        recordBrooksMediaExportFailure(index, url, 'm3u8 detection timeout')
        processNextBrooksMediaExport()
      }, BROOKS_MEDIA_EXPORT_TIMEOUT_MS),
    }
    brooksMediaExportPending.statusIntervalId = setInterval(updateBrooksMediaExportStatus, BROOKS_MEDIA_EXPORT_STATUS_INTERVAL_MS)
    updateBrooksMediaExportStatus()
    fetchBrooksMediaExportPageInfo(url, info => {
      if (!isCurrentBrooksMediaExportPending(index, url)) {
        return
      }
      createBrooksMediaExportFrame(buildBrooksMediaExportEmbedUrl(info))
    }, error => {
      if (!isCurrentBrooksMediaExportPending(index, url)) {
        return
      }
      recordBrooksMediaExportFailure(index, url, error)
      processNextBrooksMediaExport()
    })
  }

  function startBrooksMediaExport() {
    const links = getBrooksCourseVideoLinks(document)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    brooksMediaExportState = {
      running: true,
      stopped: false,
      schemaVersion: BROOKS_MEDIA_EXPORT_SCHEMA_VERSION,
      links,
      index: 0,
      records: [],
      failures: [],
      startedAt: nowIso,
      updatedAt: nowIso,
      activeElapsedMs: 0,
      activeRunStartedAt: nowIso,
    }
    saveBrooksMediaExportState()
    processNextBrooksMediaExport()
  }

  function resumeBrooksMediaExport() {
    brooksMediaExportState = loadBrooksMediaExportState()
    if (!brooksMediaExportState || !brooksMediaExportState.links || !brooksMediaExportState.links.length) {
      startBrooksMediaExport()
      return
    }
    brooksMediaExportState.running = true
    brooksMediaExportState.stopped = false
    markBrooksMediaExportRunStarted(brooksMediaExportState)
    saveBrooksMediaExportState()
    processNextBrooksMediaExport()
  }

  function pauseBrooksMediaExport() {
    if (!brooksMediaExportState) {
      brooksMediaExportState = loadBrooksMediaExportState()
    }
    if (brooksMediaExportState) {
      stopBrooksMediaExportRunTimer(brooksMediaExportState)
      brooksMediaExportState.running = false
      brooksMediaExportState.stopped = true
      saveBrooksMediaExportState()
    }
    clearBrooksMediaExportFrame()
    updateBrooksMediaExportStatus()
  }

  function toggleBrooksMediaExportPrimaryAction() {
    if (!brooksMediaExportState) {
      brooksMediaExportState = loadBrooksMediaExportState()
    }
    if (brooksMediaExportState && brooksMediaExportState.running && !brooksMediaExportState.stopped) {
      pauseBrooksMediaExport()
      return
    }
    if (brooksMediaExportState && brooksMediaExportState.stopped) {
      resumeBrooksMediaExport()
      return
    }
    startBrooksMediaExport()
  }

  function resetBrooksMediaExport() {
    clearBrooksMediaExportFrame()
    brooksMediaExportState = null
    localStorage.removeItem(BROOKS_MEDIA_INDEX_STATE_KEY)
    updateBrooksMediaExportStatus()
  }

  function retryFailedBrooksMediaExport() {
    if (!brooksMediaExportState) {
      brooksMediaExportState = loadBrooksMediaExportState()
    }
    if (!canRetryFailedBrooksMediaExport(brooksMediaExportState)) {
      return
    }
    const retryIndexes = (brooksMediaExportState.failures || [])
      .map(failure => failure.index)
      .filter(index => typeof index === 'number' && brooksMediaExportState.links[index])
    if (!retryIndexes.length) {
      return
    }
    clearBrooksMediaExportFrame()
    brooksMediaExportState.retryQueue = [...new Set(retryIndexes)]
    brooksMediaExportState.failures = []
    brooksMediaExportState.running = true
    brooksMediaExportState.stopped = false
    markBrooksMediaExportRunStarted(brooksMediaExportState)
    saveBrooksMediaExportState()
    processNextBrooksMediaExport()
  }

  function exportBrooksMediaIndex() {
    const state = brooksMediaExportState || loadBrooksMediaExportState()
    if (!state) {
      alert('没有可导出的 Brooks 视频与字幕清单')
      return
    }
    const payload = buildBrooksMediaExportPayload(state, new Date().toISOString())
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    downloadWithA(url, `brooks-media-index-${new Date().toISOString().slice(0, 10)}.json`)
    URL.revokeObjectURL(url)
  }

  function handleBrooksMediaIndexMessage(event) {
    const data = event.data || {}
    if (event.origin !== location.origin || data.type !== BROOKS_MEDIA_INDEX_MESSAGE_TYPE || !data.record) {
      return
    }
    if (!brooksMediaExportState || !brooksMediaExportPending) {
      return
    }
    if (!isSameBrooksVideoPage(data.record.pageUrl, brooksMediaExportPending.url)) {
      return
    }

    const record = {
      ...data.record,
      index: brooksMediaExportPending.index,
      url: brooksMediaExportPending.url,
      pageUrl: data.record.pageUrl,
    }
    brooksMediaExportState.records.push(record)
    advanceBrooksMediaExportQueue(brooksMediaExportPending.index)
    saveBrooksMediaExportState()
    clearBrooksMediaExportFrame()
    updateBrooksMediaExportStatus()
    setTimeout(processNextBrooksMediaExport, BROOKS_MEDIA_EXPORT_STEP_DELAY_MS)
  }

  function appendBrooksMediaExporterDom() {
    if (!isBrooksCourseIndexPage() || document.getElementById('brooks-media-export-dom') || !document.body) {
      return
    }
    const links = getBrooksCourseVideoLinks(document)
    const section = document.createElement('section')
    section.id = 'brooks-media-export-dom'
    section.style.cssText = 'position:fixed;right:20px;bottom:88px;z-index:9999;width:380px;max-width:calc(100vw - 40px);box-sizing:border-box;padding:10px 12px;background:#1f2937;color:white;border:1px solid #d1d5db;border-radius:4px;font-size:13px;line-height:1.35;box-shadow:0 4px 12px rgba(0,0,0,.18);'
    section.innerHTML = `
      <div style="margin-bottom:4px;">Brooks 视频与字幕清单</div>
      <div id="brooks-media-export-status" style="height:82px;margin-bottom:8px;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;">发现 ${links.length} 个课程视频</div>
      <div id="brooks-media-export-actions" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:32px;">
        <button id="brooks-media-export-primary" type="button">开始</button>
        <button id="brooks-media-export-retry-failed" type="button" style="display:none;">重试失败</button>
        <button id="brooks-media-export-reset" type="button" style="display:none;">重置</button>
        <button id="brooks-media-export-download" type="button">导出清单 JSON</button>
      </div>
      <div id="brooks-media-export-reset-help" style="display:none;margin-top:6px;color:#d1d5db;font-size:11px;line-height:1.35;">重置会清空当前进度和结果，不会自动开始；要放弃中断进度或失败记录时再点。</div>
    `
    section.querySelectorAll('button').forEach(button => {
      button.style.cssText = 'min-width:76px;padding:4px 8px;border:1px solid #e5e7eb;border-radius:4px;background:#2563eb;color:white;cursor:pointer;'
    })
    document.body.appendChild(section)
    document.getElementById('brooks-media-export-primary').addEventListener('click', toggleBrooksMediaExportPrimaryAction)
    document.getElementById('brooks-media-export-retry-failed').addEventListener('click', retryFailedBrooksMediaExport)
    document.getElementById('brooks-media-export-reset').addEventListener('click', resetBrooksMediaExport)
    document.getElementById('brooks-media-export-download').addEventListener('click', exportBrooksMediaIndex)
    brooksMediaExportState = loadBrooksMediaExportState()
    updateBrooksMediaExportStatus()
  }

  function startBrooksMediaExporter() {
    window.addEventListener('message', handleBrooksMediaIndexMessage)
    const scheduleAppend = () => setTimeout(appendBrooksMediaExporterDom, 0)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleAppend, { once: true })
    } else {
      scheduleAppend()
    }
  }

  return {
    handleDirectM3u8Message: handleBrooksDirectM3u8Message,
    notifyMediaIndexDetected: notifyBrooksMediaIndexDetected,
    start: startBrooksMediaExporter,
  }
}
