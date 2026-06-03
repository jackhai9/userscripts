export function normalizeBrooksTitle(title) {
  return (title || '')
    .replace(/\s*\|\s*Brooks Trading Course\s*$/i, '')
    .replace(/^BTC PAF/i, 'Video')
    .trim()
}

export function isBrooksHost(hostname) {
  return hostname === 'brookstradingcourse.com' || hostname.endsWith('.brookstradingcourse.com')
}

export function isBrooksCourseIndexPage(locationObj = location) {
  return isBrooksHost(locationObj.hostname) && locationObj.pathname.replace(/\/+$/, '') === '/main-course-videos'
}

export function isBrooksMediaPageUrl(url) {
  const path = url.pathname
  return /\/video-\d+[a-z]?-[^/]+\/?$/i.test(path) || /^\/bonus-videos\/[^/]+\/?$/i.test(path)
}

export function getBrooksCourseVideoLinks(root) {
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

export function extractBrooksMediaExportPageInfo(root, pageUrl) {
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

export function buildBrooksMediaExportEmbedUrl(info) {
  const embedUrl = new URL(info.embedSrc)
  embedUrl.searchParams.set('jhBrooksPageUrl', info.pageUrl)
  embedUrl.searchParams.set('jhBrooksTitle', info.title || '')
  return embedUrl.href
}

export function isSameBrooksVideoPage(left, right) {
  try {
    const leftUrl = new URL(left)
    const rightUrl = new URL(right)
    return leftUrl.origin === rightUrl.origin && leftUrl.pathname.replace(/\/+$/, '') === rightUrl.pathname.replace(/\/+$/, '')
  } catch (error) {
    return false
  }
}
