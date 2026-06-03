export function getBrooksMediaExportPageLabel(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    return truncateBrooksMediaExportText(parts[parts.length - 1] || url, 40)
  } catch (error) {
    return truncateBrooksMediaExportText(url || '', 40)
  }
}

export function truncateBrooksMediaExportText(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value || ''
  }
  return value.slice(0, Math.max(0, maxLength - 1)) + '…'
}

export function parseBrooksMediaExportTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (!value) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function getBrooksMediaExportElapsedMs(state, now) {
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

export function markBrooksMediaExportRunStarted(state, now) {
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

export function stopBrooksMediaExportRunTimer(state, now) {
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

export function formatBrooksMediaExportDuration(milliseconds) {
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

export function formatBrooksMediaExportStatus(options) {
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
      lines.push('请点“重试失败”；仍失败再导出清单 JSON')
    }
  }
  return lines.join('\n')
}

export function getBrooksMediaExportPrimaryLabel(state) {
  if (state && state.running && !state.stopped) {
    return '暂停'
  }
  if (state && state.stopped) {
    return '继续'
  }
  return '开始'
}

export function isBrooksMediaExportComplete(state) {
  if (!state || !state.links || !state.links.length) {
    return false
  }
  const records = state.records || []
  const failures = state.failures || []
  return records.length + failures.length >= state.links.length
}

export function canRetryFailedBrooksMediaExport(state) {
  return !!(state && !state.running && isBrooksMediaExportComplete(state) && state.failures && state.failures.length)
}

export function shouldShowBrooksMediaExportReset(state) {
  if (!state || state.running) {
    return false
  }
  if (state.stopped) {
    return true
  }
  const links = Array.isArray(state.links) ? state.links : []
  const records = Array.isArray(state.records) ? state.records : []
  const failures = Array.isArray(state.failures) ? state.failures : []
  if (failures.length) {
    return true
  }
  if (!links.length) {
    return false
  }
  return records.length + failures.length < links.length
}

export function buildBrooksMediaExportPayload(state, exportedAt) {
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
