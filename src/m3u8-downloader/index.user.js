// ==UserScript==
// @name         【改写】m3u8-downloader
// @namespace    https://github.com/jackhai9/userscripts
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      0.10.27
// @description  m3u8 下载增强脚本，仅在白名单视频站启用，避免误伤交易页等重前端应用
// @author       jackhai9
// @include      https://18jav.tv/*
// @include      https://*.18jav.tv/*
// @include      https://njav.com/*
// @include      https://*.njav.com/*
// @include      https://www.brookstradingcourse.com/*
// @include      https://brookstradingcourse.com/*
// @include      https://iframe.mediadelivery.net/*
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/m3u8-downloader.user.js
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/m3u8-downloader.user.js
// @grant        none
// @run-at document-start
// ==/UserScript==

(function () {
  'use strict';
  var showMp4 = true
  var m3u8Target = ''
  var m3u8Referer = location.href
  var mp4Objs = []
  var mp4UrlSet = new Set()
  var m3u8UrlSet = new Set()
  var originXHR = window.XMLHttpRequest
  var windowOpen = window.open
  var M3U8_MESSAGE_TYPE = 'jh-userscripts:m3u8-detected'
  var BROOKS_MEDIA_INDEX_MESSAGE_TYPE = 'jh-userscripts:brooks-media-index-record'
  var BROOKS_MEDIA_INDEX_STATE_KEY = 'jh-userscripts:brooks-media-index-export'
  var BROOKS_MEDIA_EXPORT_SCHEMA_VERSION = 2
  var BROOKS_MEDIA_EXPORT_TIMEOUT_MS = 45000
  var BROOKS_MEDIA_EXPORT_STEP_DELAY_MS = 500
  var BROOKS_MEDIA_EXPORT_STATUS_INTERVAL_MS = 1000
  var brooksMediaExportState = null
  var brooksMediaExportFrame = null
  var brooksMediaExportPending = null
  var EXTERNAL_DOWNLOADER_BLOCKED_HOST_SUFFIXES = [
    '.b-cdn.net',
    '.hshdkshd.com',
  ]

  function ajax(options) {
    options = options || {};
    let xhr = new originXHR();
    if (options.type === 'file') {
      xhr.responseType = 'arraybuffer';
    }

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        let status = xhr.status;
        if (status >= 200 && status < 300) {
          options.success && options.success(xhr.response);
        } else {
          options.fail && options.fail(status);
        }
      }
    };

    xhr.open("GET", options.url, true);
    xhr.send(null);
  }

  // 普通下载
  function downloadWithA(url, name) {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  // 检测 m3u8 链接的有效性
  function checkM3u8Url(url) {
    ajax({
      url,
      success: (fileStr) => {
        if (/(png|image|ts|jpg|mp4|jpeg|EXTINF)/.test(fileStr)) {
          const urlObj = new URL(url)
          urlObj.searchParams.append('title', getTitle())
          if (window.top !== window.self) {
            notifyParentM3u8Detected(urlObj.href)
          } else {
            showM3u8Controls(urlObj.href, location.href)
          }
          console.log('【m3u8】----------------------------------------')
          console.log(urlObj)
          console.log(buildExternalDownloaderUrl(urlObj.href))
        }
      }
    })
  }

  function notifyParentM3u8Detected(url) {
    const sourceUrl = new URL(location.href)
    const brooksExportPageUrl = sourceUrl.searchParams.get('jhBrooksPageUrl')
    const brooksExportTitle = sourceUrl.searchParams.get('jhBrooksTitle')
    window.parent.postMessage({
      type: M3U8_MESSAGE_TYPE,
      url,
      referer: location.href,
      brooksExport: brooksExportPageUrl ? {
        pageUrl: brooksExportPageUrl,
        title: brooksExportTitle || '',
      } : undefined,
    }, '*')
  }

  function listenForFrameM3u8() {
    window.addEventListener('message', (event) => {
      const data = event.data || {}
      if (data.type !== M3U8_MESSAGE_TYPE || !data.url || data.url.indexOf('.m3u8') <= 0) {
        return
      }
      if (handleBrooksDirectM3u8Message(event, data)) {
        return
      }
      showM3u8Controls(data.url, data.referer || location.href)
    })
  }

  function showM3u8Controls(url, referer) {
    m3u8Target = url
    m3u8Referer = referer || location.href
    notifyBrooksMediaIndexDetected(url, m3u8Referer)
    appendDom()

    const m3u8Jump = document.getElementById('m3u8-jump')
    document.getElementById('m3u8-close').style.display = 'block'
    document.getElementById('m3u8-append').style.display = 'block'
    document.getElementById('m3u8-copy-command').style.display = 'block'
    m3u8Jump.style.display = isExternalDownloaderBlocked(url) ? 'none' : 'block'
  }

  function buildExternalDownloaderUrl(sourceUrl) {
    return 'https://blog.luckly-mjw.cn/tool-show/m3u8-downloader/index.html?source=' + sourceUrl
  }

  function isExternalDownloaderBlocked(url) {
    try {
      const hostname = new URL(url).hostname
      return EXTERNAL_DOWNLOADER_BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
    } catch (error) {
      return false
    }
  }

  function getCleanM3u8Target() {
    if (!m3u8Target) {
      return ''
    }
    const url = new URL(m3u8Target)
    url.searchParams.delete('title')
    return url.href
  }

  function shellQuote(value) {
    return "'" + value.replace(/'/g, "'\\''") + "'"
  }

  function buildYtDlpCommand() {
    const sourceUrl = getCleanM3u8Target()
    const title = new URL(m3u8Target).searchParams.get('title') || getTitle()
    return [
      'yt-dlp',
      '--referer',
      shellQuote(m3u8Referer),
      '-N',
      '16',
      '-o',
      shellQuote(getYtDlpOutputName(title)),
      shellQuote(sourceUrl),
    ].join(' ')
  }

  function buildCaptionUrlFromM3u8(url, captionFile) {
    const sourceUrl = new URL(url)
    sourceUrl.searchParams.delete('title')
    const pathParts = sourceUrl.pathname.split('/').filter(Boolean)
    const videoIndex = pathParts.findIndex(part => part === 'video.m3u8' || part === 'playlist.m3u8')
    if (videoIndex <= 0) {
      throw new Error('Unable to infer caption path from m3u8 URL')
    }
    const baseIndex = pathParts[videoIndex] === 'video.m3u8' && videoIndex > 0 && /^\d+x\d+$/.test(pathParts[videoIndex - 1])
      ? videoIndex - 1
      : videoIndex
    sourceUrl.pathname = '/' + pathParts.slice(0, baseIndex).concat(['captions', captionFile]).join('/')
    sourceUrl.hash = ''
    return sourceUrl.href
  }

  function getCleanMediaUrl(url) {
    const sourceUrl = new URL(url)
    sourceUrl.searchParams.delete('title')
    return sourceUrl.href
  }

  function getBrooksVideoIdFromM3u8(url) {
    const sourceUrl = new URL(url)
    const pathParts = sourceUrl.pathname.split('/').filter(Boolean)
    const videoIndex = pathParts.findIndex(part => part === 'video.m3u8' || part === 'playlist.m3u8')
    if (videoIndex <= 0) {
      return ''
    }
    const baseIndex = pathParts[videoIndex] === 'video.m3u8' && videoIndex > 0 && /^\d+x\d+$/.test(pathParts[videoIndex - 1])
      ? videoIndex - 1
      : videoIndex
    return pathParts[baseIndex - 1] || ''
  }

  function getYtDlpOutputName(title) {
    return title
      .replace(/\s*\|\s*Brooks Trading Course\s*$/i, '')
      .replace(/[/:*?"<>|]/g, '_')
      .trim() + '.%(ext)s'
  }

  function normalizeBrooksTitle(title) {
    return (title || '')
      .replace(/\s*\|\s*Brooks Trading Course\s*$/i, '')
      .replace(/^BTC PAF/i, 'Video')
      .trim()
  }

  function buildBrooksMediaIndexRecord(options) {
    const sourceUrl = new URL(options.m3u8Url)
    const mediaTitle = sourceUrl.searchParams.get('title') || options.title || ''
    return {
      ok: true,
      url: options.pageUrl,
      title: options.title || mediaTitle,
      mediaTitle,
      pageUrl: options.pageUrl,
      output: getYtDlpOutputName(mediaTitle),
      referer: options.referer || '',
      m3u8: getCleanMediaUrl(options.m3u8Url),
      videoId: getBrooksVideoIdFromM3u8(options.m3u8Url),
      cn: buildCaptionUrlFromM3u8(options.m3u8Url, 'CN.vtt'),
      en: buildCaptionUrlFromM3u8(options.m3u8Url, 'EN.vtt'),
      index: options.index,
    }
  }

  function isBrooksHost(hostname) {
    return hostname === 'brookstradingcourse.com' || hostname.endsWith('.brookstradingcourse.com')
  }

  function isBrooksCourseIndexPage() {
    return isBrooksHost(location.hostname) && location.pathname.replace(/\/+$/, '') === '/main-course-videos'
  }

  function isBrooksMediaPageUrl(url) {
    const path = url.pathname
    return /\/video-\d+[a-z]?-[^/]+\/?$/i.test(path) || /^\/bonus-videos\/[^/]+\/?$/i.test(path)
  }

  function getBrooksCourseVideoLinks(root) {
    const seen = new Set()
    const baseHref = root.defaultView?.location?.href || location.href
    return Array.from(root.querySelectorAll('a[href]'))
      .map(link => {
        try {
          const url = new URL(link.getAttribute('href'), baseHref)
          url.hash = ''
          return url
        } catch (error) {
          return null
        }
      })
      .filter(url => url && isBrooksHost(url.hostname) && isBrooksMediaPageUrl(url))
      .map(url => url.href)
      .filter(href => {
        if (seen.has(href)) {
          return false
        }
        seen.add(href)
        return true
      })
  }

  function extractBrooksMediaExportPageInfo(root, pageUrl) {
    const embed = Array.from(root.querySelectorAll('iframe[src*="iframe.mediadelivery.net/embed/"]'))[0]
    const embedSrc = embed && embed.getAttribute('src')
    if (!embedSrc) {
      throw new Error('Bunny embed iframe not found')
    }
    const metaTitle = root.querySelector('meta[property="og:title"]')
    const title = normalizeBrooksTitle((metaTitle && metaTitle.getAttribute('content')) || root.title || '')
    return {
      pageUrl,
      title,
      embedSrc: new URL(embedSrc, pageUrl).href,
    }
  }

  function buildBrooksMediaExportEmbedUrl(info) {
    const embedUrl = new URL(info.embedSrc)
    embedUrl.searchParams.set('jhBrooksPageUrl', info.pageUrl)
    embedUrl.searchParams.set('jhBrooksTitle', info.title || '')
    return embedUrl.href
  }

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

  function getBrooksMediaExportPageLabel(url) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean)
      return truncateBrooksMediaExportText(parts[parts.length - 1] || url, 40)
    } catch (error) {
      return truncateBrooksMediaExportText(url || '', 40)
    }
  }

  function truncateBrooksMediaExportText(value, maxLength) {
    if (!value || value.length <= maxLength) {
      return value || ''
    }
    return value.slice(0, Math.max(0, maxLength - 1)) + '…'
  }

  function parseBrooksMediaExportTime(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (!value) {
      return null
    }
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : null
  }

  function getBrooksMediaExportElapsedMs(state, now) {
    if (!state) {
      return null
    }
    const baseElapsedMs = typeof state.activeElapsedMs === 'number' && Number.isFinite(state.activeElapsedMs)
      ? Math.max(0, state.activeElapsedMs)
      : null
    const activeRunStartedAt = parseBrooksMediaExportTime(state.activeRunStartedAt)
    if (baseElapsedMs === null && activeRunStartedAt === null) {
      return null
    }
    const fallbackNow = typeof now === 'number' ? now : Date.now()
    const activeRunMs = state.running && activeRunStartedAt !== null
      ? Math.max(0, fallbackNow - activeRunStartedAt)
      : 0
    return (baseElapsedMs || 0) + activeRunMs
  }

  function markBrooksMediaExportRunStarted(state, now) {
    if (!state) {
      return
    }
    if (typeof state.activeElapsedMs !== 'number' || !Number.isFinite(state.activeElapsedMs)) {
      state.activeElapsedMs = 0
    }
    if (parseBrooksMediaExportTime(state.activeRunStartedAt) === null) {
      state.activeRunStartedAt = new Date(typeof now === 'number' ? now : Date.now()).toISOString()
    }
  }

  function stopBrooksMediaExportRunTimer(state, now) {
    if (!state) {
      return null
    }
    const activeRunStartedAt = parseBrooksMediaExportTime(state.activeRunStartedAt)
    if (typeof state.activeElapsedMs !== 'number' || !Number.isFinite(state.activeElapsedMs)) {
      state.activeElapsedMs = 0
    }
    if (activeRunStartedAt !== null) {
      const endedAt = typeof now === 'number' ? now : Date.now()
      state.activeElapsedMs += Math.max(0, endedAt - activeRunStartedAt)
      delete state.activeRunStartedAt
    }
    return state.activeElapsedMs
  }

  function formatBrooksMediaExportDuration(milliseconds) {
    if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) {
      return ''
    }
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
    const seconds = totalSeconds % 60
    const totalMinutes = Math.floor(totalSeconds / 60)
    const minutes = totalMinutes % 60
    const hours = Math.floor(totalMinutes / 60)
    if (hours) {
      return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`
    }
    if (minutes) {
      return `${minutes}m${String(seconds).padStart(2, '0')}s`
    }
    return `${seconds}s`
  }

  function formatBrooksMediaExportStatus(options) {
    const state = options && options.state
    if (!state) {
      return ''
    }
    const links = state.links || []
    const records = state.records || []
    const failures = state.failures || []
    const total = links.length
    const done = records.length + failures.length
    const stateText = state.running ? '采集中' : (state.stopped ? '已暂停' : '已完成')
    const summaryParts = [
      `${stateText} ${done}/${total}`,
      `成功 ${records.length}`,
      `失败 ${failures.length}`,
    ]
    const lines = [summaryParts.join(' | ')]
    const elapsedText = formatBrooksMediaExportDuration(getBrooksMediaExportElapsedMs(state, options && options.now))
    if (elapsedText) {
      lines.push(`耗时: ${elapsedText}`)
    }

    const pending = options && options.pending
    if (pending && pending.url) {
      const currentIndex = typeof pending.index === 'number' ? pending.index + 1 : (state.index || 0) + 1
      const currentParts = [`当前 ${currentIndex}/${total} ${getBrooksMediaExportPageLabel(pending.url)}`]
      if (pending.startedAt) {
        const elapsedSeconds = Math.max(0, Math.floor(((options.now || Date.now()) - pending.startedAt) / 1000))
        currentParts.push(`等待 ${elapsedSeconds}s`)
      }
      lines.push(currentParts.join(' | '))
    }

    const lastFailure = failures[failures.length - 1]
    if (lastFailure && lastFailure.error) {
      lines.push(`最近失败: ${lastFailure.error}`)
      if (!state.running && failures.length) {
        lines.push('请点“重试失败”；仍失败再导出 JSON')
      }
    }
    return lines.join('\n')
  }

  function getBrooksMediaExportPrimaryLabel(state) {
    if (state && state.running && !state.stopped) {
      return '暂停'
    }
    if (state && state.stopped) {
      return '继续'
    }
    return '开始'
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
    if (resetButton) {
      resetButton.style.display = state && !state.running ? '' : 'none'
    }
  }

  function updateBrooksMediaExportStatus() {
    const statusEl = document.getElementById('brooks-media-export-status')
    if (!statusEl) {
      return
    }
    const state = brooksMediaExportState || loadBrooksMediaExportState()
    if (!state) {
      statusEl.textContent = `发现 ${getBrooksCourseVideoLinks(document).length} 个视频页`
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

  function isSameBrooksVideoPage(left, right) {
    try {
      const leftUrl = new URL(left)
      const rightUrl = new URL(right)
      return leftUrl.origin === rightUrl.origin && leftUrl.pathname.replace(/\/+$/, '') === rightUrl.pathname.replace(/\/+$/, '')
    } catch (error) {
      return false
    }
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

  function isBrooksMediaExportComplete(state) {
    if (!state || !state.links || !state.links.length) {
      return false
    }
    const records = state.records || []
    const failures = state.failures || []
    return records.length + failures.length >= state.links.length
  }

  function canRetryFailedBrooksMediaExport(state) {
    return !!(state && !state.running && isBrooksMediaExportComplete(state) && state.failures && state.failures.length)
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

  function buildBrooksMediaExportPayload(state, exportedAt) {
    const links = state && state.links ? state.links : []
    const records = state && state.records ? state.records : []
    const failures = state && state.failures ? state.failures : []
    const elapsedMs = getBrooksMediaExportElapsedMs(state, parseBrooksMediaExportTime(exportedAt) || Date.now())
    const completedIndexes = new Set(records.concat(failures).map(item => item.index))
    const missingIndexes = links
      .map((url, index) => index)
      .filter(index => !completedIndexes.has(index))
    const done = records.length + failures.length
    return {
      exportedAt,
      startedAt: state && state.startedAt ? state.startedAt : null,
      updatedAt: state && state.updatedAt ? state.updatedAt : null,
      elapsedMs,
      elapsedSeconds: elapsedMs === null ? null : Math.floor(elapsedMs / 1000),
      elapsedText: formatBrooksMediaExportDuration(elapsedMs),
      total: links.length,
      done,
      completed: links.length > 0 && done >= links.length,
      nextIndex: state && typeof state.index === 'number' ? state.index : 0,
      running: !!(state && state.running),
      stopped: !!(state && state.stopped),
      missingIndexes,
      records,
      failures,
    }
  }

  function exportBrooksMediaIndex() {
    const state = brooksMediaExportState || loadBrooksMediaExportState()
    if (!state) {
      alert('没有可导出的 Brooks 媒体索引')
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
      <div style="margin-bottom:4px;">Brooks 媒体索引</div>
      <div id="brooks-media-export-status" style="height:82px;margin-bottom:8px;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;">发现 ${links.length} 个视频页</div>
      <div id="brooks-media-export-actions" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:32px;">
        <button id="brooks-media-export-primary" type="button">开始</button>
        <button id="brooks-media-export-retry-failed" type="button" style="display:none;">重试失败</button>
        <button id="brooks-media-export-reset" type="button" style="display:none;">重置</button>
        <button id="brooks-media-export-download" type="button">导出 JSON</button>
      </div>
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

  function sanitizeInjectedDownloader(section) {
    const promoSelectors = [
      'script',
      '#m-loading',
      '.m-p-help',
      '.m-p-mse',
      '.m-p-tamper',
      '.m-p-github',
      '.m-p-other',
      '.m-p-language',
      '.m-p-refer',
      '.m-p-final',
      '.m-p-tips[v-else]',
      'a[href*="segmentfault.com"]',
      'a[href*="github.com/Momo707577045"]',
      'a[href*="media-source-extract"]',
      'a[href*="tool-show/index.html"]',
      'a[href*="m3u8-downloader.user.js"]',
      'a[href*="index-en.html"]',
      'img[src*="/Assets/qrcode/"]',
      'img[src*="/tool-show/m3u8-downloader/imgs/"]',
    ]

    section.querySelectorAll(promoSelectors.join(',')).forEach(node => node.remove())

    const style = document.createElement('style')
    style.textContent = `
      .m-p-help,
      .m-p-mse,
      .m-p-tamper,
      .m-p-github,
      .m-p-other,
      .m-p-language,
      .m-p-refer,
      .m-p-final,
      .m-p-tips[v-else] {
        display: none !important;
      }
    `
    section.appendChild(style)
  }

  function copyToClipboard(content) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(content).catch(() => copyToClipboardWithTextarea(content))
      return
    }
    copyToClipboardWithTextarea(content)
  }

  function copyToClipboardWithTextarea(content) {
    const textarea = document.createElement('textarea')
    textarea.style.opacity = '0'
    textarea.value = content
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }

  function normalizeMediaUrl(url) {
    if (!url) {
      return ''
    }
    try {
      return new URL(url, location.href).href
    } catch (error) {
      return url.toString()
    }
  }

  function registerM3u8Url(url) {
    url = normalizeMediaUrl(url)
    if (url.indexOf('.m3u8') <= 0 || m3u8UrlSet.has(url)) {
      return
    }
    m3u8UrlSet.add(url)
    checkM3u8Url(url)
  }

  function registerMp4Url(url) {
    url = normalizeMediaUrl(url)
    if (url.indexOf('.mp4') <= 0 || mp4UrlSet.has(url)) {
      return
    }
    mp4UrlSet.add(url)
    appendDom();
    document.getElementById('mp4-show').style.display = 'block'
    mp4Objs.push({
      url,
      fileName: url.slice(url.lastIndexOf('/') + 1).split('?')[0],
    });
  }

  function scanVideo(video) {
    const sourceUrls = [video.currentSrc, video.src]
      .concat(Array.from(video.querySelectorAll('source')).map(source => source.src))
      .filter(Boolean)

    sourceUrls.forEach(registerM3u8Url)
    registerMp4Url(video.currentSrc || video.src)
  }

  function scanMedia(root) {
    if (!root || !root.querySelectorAll) {
      return
    }
    if (root.matches && root.matches('video')) {
      scanVideo(root)
    }
    root.querySelectorAll('video').forEach(scanVideo)
  }

  function nodeMayContainMedia(node) {
    if (!node || node.nodeType !== 1) {
      return false
    }
    if (node.matches && node.matches('video, source')) {
      return true
    }
    return !!(node.querySelector && node.querySelector('video, source'))
  }

  function startMediaScan() {
    let pendingScan = false
    const scheduleScan = () => {
      if (pendingScan) {
        return
      }
      pendingScan = true
      requestAnimationFrame(() => {
        pendingScan = false
        scanMedia(document)
      })
    }

    scanMedia(document)
    document.addEventListener('DOMContentLoaded', scheduleScan, { once: true })
    window.addEventListener('load', scheduleScan, { once: true })

    const observeTarget = document.documentElement || document
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && nodeMayContainMedia(mutation.target)) {
          scheduleScan()
          return
        }
        if (mutation.type !== 'childList') {
          continue
        }
        for (const node of mutation.addedNodes) {
          if (nodeMayContainMedia(node)) {
            scheduleScan()
            return
          }
        }
      }
    }).observe(observeTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    })
  }

  async function downloadCaption(url) {
    try {
        const title = getTitle();
        const lang = url.includes('/CN.vtt') ? 'zh' : 'en';
        const filename = `${title}.${lang}.vtt`;

        console.log(`Downloading caption: ${url}`);
        console.log(`Saving as: ${filename}`);

        // 使用 XMLHttpRequest 替代 fetch
        return new Promise((resolve, reject) => {
            let xhr = new originXHR();// 使用原始的 XMLHttpRequest
            xhr.open('GET', url, true);
            xhr.responseType = 'text';

            xhr.onload = function() {
                if (xhr.status === 200) {
                    // 创建 Blob 对象
                    const blob = new Blob([xhr.response], { type: 'text/vtt' });
                    const downloadUrl = URL.createObjectURL(blob);

                    // 创建下载链接并触发下载
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    // 清理 URL 对象
                    URL.revokeObjectURL(downloadUrl);

                    console.log(`Caption downloaded: ${filename}`);
                    resolve();
                } else {
                    reject(new Error(`Failed to download caption: ${xhr.status}`));
                }
            };

            xhr.onerror = function() {
                reject(new Error('Network error occurred'));
            };

            xhr.send();
        });

    } catch (error) {
        console.error('Error downloading caption:', error);
    }
}

  function resetAjax() {
    if (window._hadResetAjax) { // 如果已经重置过，则不再进入。解决开发时局部刷新导致重新加载问题
      return
    }
    window._hadResetAjax = true

    var originOpen = originXHR.prototype.open
    window.XMLHttpRequest = function () {
      var realXHR = new originXHR()
      realXHR.open = function (method, url) {
        registerM3u8Url(url && url.toString())
        // if (url.toString() && url.toString().toLocaleLowerCase().indexOf('.mp4') > 0) {
        //   appendDom();
        //   document.getElementById('mp4-show').style.display = 'block'
        //   mp4Objs.push({
        //     url,
        //     fileName: url.slice(url.lastIndexOf('/') + 1).split('?')[0],
        //   });
        // }
        originOpen.call(realXHR, method, url)
      }
      return realXHR
    }
    window.XMLHttpRequest.UNSENT = originXHR.UNSENT;
    window.XMLHttpRequest.OPENED = originXHR.OPENED;
    window.XMLHttpRequest.HEADERS_RECEIVED = originXHR.HEADERS_RECEIVED;
    window.XMLHttpRequest.LOADING = originXHR.LOADING;
    window.XMLHttpRequest.DONE = originXHR.DONE;
    window.XMLHttpRequest.prototype = originXHR.prototype;
  }

  // 获取顶部 window title，因可能存在跨域问题，故使用 try catch 进行保护
  function getTitle() {
    let title = document.title;
    let metaTitle = document.querySelector('meta[property="og:title"]');
    if (metaTitle) {
        title = metaTitle.getAttribute('content');
        console.log("从 meta 获取标题:", title);
    }
    return title.replace("BTC PAF","Video")
  }

  function findRefererIframe(referer) {
    if (!referer || referer === location.href) {
      return null
    }
    const refererUrl = new URL(referer)
    const videoId = refererUrl.pathname.split('/').filter(Boolean).pop()
    return Array.from(document.querySelectorAll('iframe')).find(iframe => {
      if (iframe.src === referer) {
        return true
      }
      return videoId && iframe.src.indexOf(videoId) > -1
    })
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function findVisibleMediaElement() {
    const refererIframe = findRefererIframe(m3u8Referer)
    if (refererIframe) {
      return refererIframe
    }

    const video = Array.from(document.querySelectorAll('video')).find(isVisibleElement)
    if (video) {
      return video
    }

    return Array.from(document.querySelectorAll('iframe')).find(isVisibleElement)
  }

  function appendDom() {
    if (document.getElementById('m3u8-download-dom')) {
      return
    }
    var domStr = `
    <div style="
    display: none;
    margin-top: 6px;
    padding: 6px 10px;
    font-size: 18px;
    color: white;
    cursor: pointer;
    border-radius: 4px;
    border: 1px solid #eeeeee;
    background-color: #3D8AC7;
  " id="mp4-show">MP4下载</div>
  <div style="
    display: none;
    margin-top: 6px;
    padding: 6px 10px ;
    font-size: 18px;
    color: white;
    cursor: pointer;
    border-radius: 4px;
    border: 1px solid #eeeeee;
    background-color: #3D8AC7;
  " id="m3u8-jump">跳转下载</div>
  <div style="
    display: none;
    margin-top: 6px;
    padding: 6px 10px ;
    font-size: 18px;
    color: white;
    cursor: pointer;
    border-radius: 4px;
    border: 1px solid #eeeeee;
    background-color: #3D8AC7;
  " id="m3u8-append">注入下载</div>
  <div style="
    display: none;
    margin-top: 6px;
    padding: 6px 10px ;
    font-size: 18px;
    color: white;
    cursor: pointer;
    border-radius: 4px;
    border: 1px solid #eeeeee;
    background-color: #3D8AC7;
  " id="m3u8-copy-command">复制 yt-dlp 命令</div>
  <div style="
    margin-top: 4px;
    height: 34px;
    width: 34px;
    line-height: 34px;
    display: inline-block;
    border-radius: 50px;
    background-color: rgba(0, 0, 0, 0.5);
  " id="m3u8-close">
    <img style="
      padding-top: 4px;
      width: 24px;
      cursor: pointer;
    " src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAAk1BMVEUAAAD////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////ROyVeAAAAMHRSTlMA1Sq7gPribxkJx6Ey8onMsq+GTe10QF8kqJl5WEcvIBDc0sHAkkk1FgO2ZZ+dj1FHfPqwAAACNElEQVRIx6VW6ZqqMAwtFlEW2Rm3EXEfdZa+/9PdBEvbIVXu9835oW1yjiQlTWQE/iYPuTObOTzMNz4bQFRlY2FgnFXRC/o01mytiafP+BPvQZk56bcLSOXem1jpCy4QgXvRtlEVCARfUP65RM/hp29/+0R7eSbhoHlnffZ8h76e6x1tyw9mxXaJ3nfTVLd89hQr9NfGceJxfLIXmONh6eNNYftNSESRmgkHlEOjmhgBbYcEW08FFQN/ro6dvAczjhgXEdQP76xHEYxM+igQq259gLrCSlwbD3iDtTMy+A4Yuk0B6zV8c+BcO2OgFIp/UvJdG4o/Rp1JQYXeZFflPEFMfvugiFGFXN587YtgX7C8lRGFXPCGGYCCzlkoxJ4xqmi/jrIcdYYh5pwxiwI/gt7lDDFrcLiMKhBJ//W78ENsJgVUsV8wKpjZBXshM6cCW0jbRAilICFxIpgGMmmiWGHSIR6ViY+DPFaqSJCbQ5mbxoZLIlU0Al/cBj6N1uXfFI0okLppi69StmumSFQRP6oIKDedFi3vRDn3j6KozCZlu0DdJb3AupJXNLmqkk9+X9FEHLt1Jq8oi1H5n01AtRlvwQZQl9hmtPY4JEjMDs5ftWJN4Xr4lLrV2OHiUDHCPgvA/Tn/hP4zGUBfjZ3eLJ+NIOfHxi8CMoAQtYfmw93v01O0e7VlqqcCsXML3Vsu94cxnb4c7ML5chG8JIP9b38dENGaj3+x+TpiA/AL/fen8In7H8l3ZjdJQt2TAAAAAElFTkSuQmCC">
  </div>
    `
    var $section = document.createElement('section')
    $section.id = 'm3u8-download-dom'
    $section.style.zIndex = '9999'
    $section.style.textAlign = 'center'
    $section.innerHTML = domStr
    const mediaElement = findVisibleMediaElement()
    if (mediaElement && mediaElement.parentNode) {
      $section.style.position = 'relative'
      $section.style.margin = '10px 0 16px auto'
      $section.style.width = 'fit-content'
      mediaElement.insertAdjacentElement('afterend', $section)
    } else {
      $section.style.position = 'fixed'
      $section.style.bottom = '20px'
      $section.style.right = '20px'
      document.body.appendChild($section)
    }

    var mp4Show = document.getElementById('mp4-show')
    var m3u8Jump = document.getElementById('m3u8-jump')
    var m3u8Close = document.getElementById('m3u8-close')
    var m3u8Append = document.getElementById('m3u8-append')
    var m3u8CopyCommand = document.getElementById('m3u8-copy-command')

    mp4Show.addEventListener('click', function () {
      showMp4 = !showMp4
      mp4Show.innerHTML = showMp4 ? 'MP4下载' : '关闭MP4'
      switchMp4Download();
    })

    m3u8Close.addEventListener('click', function () {
      $section.remove()
    })

    m3u8Jump.addEventListener('click', function () {
      windowOpen(buildExternalDownloaderUrl(m3u8Target))
    })

    m3u8CopyCommand.addEventListener('click', function () {
      copyToClipboard(buildYtDlpCommand())
      alert('yt-dlp 命令已复制')
    })

    m3u8Append.addEventListener('click', function () {
      // Derive captions from the actual media host so Brooks videos keep working
      // when Bunny serves different libraries from different CDN hostnames.
      if (!m3u8Target) return;

      let cnUrl = ''
      let enUrl = ''
      try {
        cnUrl = buildCaptionUrlFromM3u8(getCleanM3u8Target(), 'CN.vtt');
        enUrl = buildCaptionUrlFromM3u8(getCleanM3u8Target(), 'EN.vtt');
      } catch (error) {
        console.error('Unable to infer caption URLs:', error);
        alert('无法从当前 m3u8 地址推导字幕地址')
        return
      }

      console.log("尝试下载字幕:", cnUrl, enUrl);

      // 下载字幕
      downloadCaption(cnUrl);
      downloadCaption(enUrl);

      ajax({
        url: 'https://blog.luckly-mjw.cn/tool-show/m3u8-downloader/index.html?t=' + new Date().getTime(),
        success: (fileStr) => {
          let fileList = fileStr.split(`<!--vue 前端框架--\>`);
          let dom = fileList[0];
          let script = fileList[1] + fileList[2];
          script = script.split('// script注入');
          script = script[1] + script[2];

          if (m3u8Target) {
            script = script.replace(`url: '', // 在线链接`, `url: '${m3u8Target}',`);
          }

          // 注入html
          let $section = document.createElement('section')
          $section.innerHTML = `${dom}`
          sanitizeInjectedDownloader($section)
          $section.style.width = '100%'
          $section.style.minHeight = '800px'
          $section.style.marginTop = '24px'
          $section.style.position = 'relative'
          $section.style.zIndex = '9999'
          $section.style.fontSize = '14px'
          $section.style.overflowY = 'auto'
          $section.style.backgroundColor = 'white'
          document.body.appendChild($section);

          ajax({ // 加载 ASE 解密
            url: 'https://upyun.luckly-mjw.cn/lib/stream-saver.js',
            success: (streamSaverStr) => {
              let $streamSaver = document.createElement('script')
              $streamSaver.innerHTML = streamSaverStr
              document.body.appendChild($streamSaver);
              ajax({ // 加载 mp4 转码
                url: 'https://blog.luckly-mjw.cn/tool-show/m3u8-downloader/mux-mp4.js',
                success: (mp4Str) => {
                  let $mp4 = document.createElement('script')
                  $mp4.innerHTML = mp4Str
                  document.body.appendChild($mp4);
                  ajax({ // 加载 stream 流式下载器
                    url: 'https://blog.luckly-mjw.cn/tool-show/m3u8-downloader/aes-decryptor.js',
                    success: (aseStr) => {
                      let $ase = document.createElement('script')
                      $ase.innerHTML = aseStr
                      document.body.appendChild($ase);
                      ajax({ // 加载 vue
                        url: 'https://upyun.luckly-mjw.cn/lib/vue.js',
                        success: (vueStr) => {
                          let $vue = document.createElement('script')
                          $vue.innerHTML = vueStr
                          document.body.appendChild($vue);
                          alert('注入成功，请滚动到页面底部')
                          eval(script)
                        }
                      })
                    }
                  })
                }
              })
            }
          })

        },
      })
    })

  }

  function switchMp4Download() {
    // 切换显示
    if (document.getElementById('mp4-download-dom')) {
      document.getElementById('mp4-download-dom').remove();
      return
    }
    var $section = document.createElement('section')
    $section.id = 'mp4-download-dom'
    $section.style.position = 'fixed'
    $section.style.zIndex = '9999'
    $section.style.top = '20px'
    $section.style.right = '20px'
    $section.style.textAlign = 'center'
    mp4Objs.forEach(obj => {
      var $mp4 = document.createElement('div')
      $mp4.innerHTML = obj.fileName
      $mp4.title = obj.url
      $mp4.style = `
      margin-top: 4px;
      padding: 3px 4px ;
      font-size: 12px;
      color: white;
      cursor: pointer;
      border-radius: 2px;
      border: 1px solid #eeeeee;
      background-color: #3D8AC7;
      `
      $mp4.addEventListener('click', () => {
        downloadWithA(obj.url, obj.fileName);
      })
      $section.appendChild($mp4);
    })
    document.body.appendChild($section);
  }

  resetAjax()
  listenForFrameM3u8()
  startMediaScan()
  startBrooksMediaExporter()
})();
