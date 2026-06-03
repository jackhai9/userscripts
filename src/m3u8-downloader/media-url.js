import { EXTERNAL_DOWNLOADER_BLOCKED_HOST_SUFFIXES } from './constants.js'

export function buildExternalDownloaderUrl(sourceUrl) {
  return 'https://blog.luckly-mjw.cn/tool-show/m3u8-downloader/index.html?source=' + sourceUrl
}

export function isExternalDownloaderBlocked(url) {
  try {
    const hostname = new URL(url).hostname
    return EXTERNAL_DOWNLOADER_BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
  } catch (error) {
    return false
  }
}

export function shellQuote(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function buildCaptionUrlFromM3u8(url, captionFile) {
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

export function getCleanMediaUrl(url) {
  const sourceUrl = new URL(url)
  sourceUrl.searchParams.delete('title')
  return sourceUrl.href
}

export function getBrooksVideoIdFromM3u8(url) {
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

export function getYtDlpOutputName(title) {
  return title
    .replace(/\s*\|\s*Brooks Trading Course\s*$/i, '')
    .replace(/[/:*?"<>|]/g, '_')
    .trim() + '.%(ext)s'
}
