import {
  buildCaptionUrlFromM3u8,
  getBrooksVideoIdFromM3u8,
  getCleanMediaUrl,
  getYtDlpOutputName,
} from './media-url.js'

export function buildBrooksMediaIndexRecord(options) {
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
