// ==UserScript==
// @name         【改写】m3u8-downloader
// @namespace    https://github.com/jackhai9/userscripts
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      0.10.17
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
    window.parent.postMessage({
      type: M3U8_MESSAGE_TYPE,
      url,
      referer: location.href,
    }, '*')
  }

  function listenForFrameM3u8() {
    window.addEventListener('message', (event) => {
      const data = event.data || {}
      if (data.type !== M3U8_MESSAGE_TYPE || !data.url || data.url.indexOf('.m3u8') <= 0) {
        return
      }
      showM3u8Controls(data.url, data.referer || location.href)
    })
  }

  function showM3u8Controls(url, referer) {
    m3u8Target = url
    m3u8Referer = referer || location.href
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
    const output = title.replace(/[/:*?"<>|]/g, '_') + '.%(ext)s'
    return [
      'yt-dlp',
      '--referer',
      shellQuote(m3u8Referer),
      '-N',
      '16',
      '-o',
      shellQuote(output),
      shellQuote(sourceUrl),
    ].join(' ')
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

        // 获取视频 ID
    const videoUrl = m3u8Target;
    if (!videoUrl) return;

    const videoId = videoUrl.split('/')[3];// 从 m3u8 URL 中提取视频 ID
    console.log("视频 ID:", videoId);

    // 构造字幕 URL
    const baseUrl = `https://vz-9a847249-45e.b-cdn.net/${videoId}`;
    const cnUrl = `${baseUrl}/captions/CN.vtt`;
    const enUrl = `${baseUrl}/captions/EN.vtt`;

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
})();
