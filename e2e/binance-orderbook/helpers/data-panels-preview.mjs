import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cmcDetail, tradingDataset } from '../../../test/helpers/data-media-migration-host.js';

const output = new URL('../../../output/data-panels-preview/', import.meta.url);
const anchor = Date.UTC(2026, 9, 9, 0, 0, 0);
const dataset = tradingDataset(anchor, { oi: 104_000, previousOi: 100_000, supply: 20_000_000, ratio: 1.23, funding: 0.00000029 });
const shape = [0, 0.15, 0.08, 0.18, 0.11, 0.06, 0.25, 0.23, 0.42, 0.38, 0.46, 0.33, 0.57, 0.62, 0.53, 0.65, 0.72, 0.59, 0.7, 0.75, 0.79, 0.63, 0.69, 0.73, 0.84, 0.92, 0.86, 0.95, 0.89, 1];
dataset.openInterestHist = shape.map((value, index) => ({
  timestamp: anchor - (shape.length - 1 - index) * 300_000,
  sumOpenInterest: String(100_000 + value * 4_000), sumOpenInterestValue: String((100_000 + value * 4_000) * 60_000),
  CMCCirculatingSupply: '20000000',
}));
for (const [key, base, range] of [
  ['topLongShortAccountRatio', 1.05, 0.18],
  ['topLongShortPositionRatio', 1.12, 0.28],
  ['globalLongShortAccountRatio', 1.02, 0.12],
]) {
  dataset[key] = shape.map((value, index) => ({ timestamp: anchor - (shape.length - 1 - index) * 300_000, longShortRatio: String(base + value * range) }));
}
dataset.takerlongshortRatio = shape.map((value, index) => {
  const buy = 480 + value * 320;
  const sell = 430 + shape[shape.length - 1 - index] * 290;
  return { timestamp: anchor - (shape.length - 1 - index) * 300_000, buyVol: String(buy), sellVol: String(sell), buySellRatio: String(buy / sell) };
});
dataset.basis = shape.map((value, index) => ({ timestamp: anchor - (shape.length - 1 - index) * 300_000, basisRate: String(-0.0014 + value * 0.0004) }));
dataset.fundingRate = Array.from({ length: 40 }, (_, index) => ({
  symbol: 'BTCUSDT', fundingTime: anchor - (39 - index) * 14_400_000,
  fundingRate: String(index === 39 ? 0.00000029 : (index % 11 === 0 ? -1 : 1) * (0.00005 + shape[index % shape.length] * 0.00005)),
}));

const artifacts = [];
for (const name of ['binance-trading-data', 'binance-coinmarketcap-data']) {
  const source = await readFile(new URL(`../../../scripts/${name}.user.js`, import.meta.url), 'utf8');
  const version = source.match(/^\/\/ @version\s+(.+)$/m)?.[1];
  if (!version) throw new Error(`Missing generated version for ${name}`);
  artifacts.push({ name, version, sha256: createHash('sha256').update(source).digest('hex'), source });
}

/** Run unchanged generated source with explicit offline boundaries inside a fresh iframe realm. */
function bootPreview(configuration) {
  const { locale, theme, selection, anchor, artifacts } = configuration;
  const now = Date.now();
  const shift = now - anchor;
  const dataset = configuration.dataset;
  for (const [endpoint, response] of Object.entries(dataset)) {
    if (endpoint === 'fundingInfo') continue;
    if (endpoint === 'premiumIndex') {
      response.time += shift;
      response.nextFundingTime += shift;
    } else {
      for (const row of response) row[endpoint === 'fundingRate' ? 'fundingTime' : 'timestamp'] += shift;
    }
  }
  const detail = configuration.detail;
  detail.latestUpdateTime = new Date(now).toISOString();
  const colors = theme === 'dark'
    ? { PrimaryBg: '#1e2329', SecondaryBg: '#242a32', TextPrimary: '#eaecef', TextSecondary: '#a6b0bf', Line: '#353d48', Buy: '#65c59c', Sell: '#ff7c8f', PrimaryYellow: '#f0b90b' }
    : { PrimaryBg: '#ffffff', SecondaryBg: '#fafbfc', TextPrimary: '#202630', TextSecondary: '#626c7d', Line: '#e4e8ef', Buy: '#24865e', Sell: '#db3a50', PrimaryYellow: '#b68208' };
  document.documentElement.lang = locale;
  document.documentElement.style.colorScheme = theme;
  for (const [name, color] of Object.entries(colors)) document.documentElement.style.setProperty(`--color-${name}`, color);
  document.body.style.cssText = `margin:0;background:${theme === 'dark' ? '#0b0e11' : '#f0f2f5'};font:13px system-ui;color:var(--color-TextSecondary)`;
  const note = document.createElement('div');
  note.textContent = locale === 'zh-CN' ? '示例数据 · BTCUSDT · 离线预览' : 'Example data · BTCUSDT · Offline preview';
  note.style.cssText = 'position:fixed;left:16px;top:14px;font-size:12px;z-index:1';
  document.body.append(note);
  const previewLocation = {
    origin: 'https://www.binance.com', hostname: 'www.binance.com',
    pathname: `/${locale}/futures/BTCUSDT`, href: `https://www.binance.com/${locale}/futures/BTCUSDT`,
  };
  const storage = new Map();
  const previewStorage = {
    getItem: key => storage.has(String(key)) ? storage.get(String(key)) : null,
    setItem: (key, value) => storage.set(String(key), String(value)),
    removeItem: key => storage.delete(String(key)),
    clear: () => storage.clear(),
  };
  const requests = [];
  window.previewEvidence = { requests, versions: artifacts.map(({ name, version, sha256 }) => ({ name, version, sha256 })) };

  function requireParams(url, expected) {
    const actual = Object.fromEntries(url.searchParams);
    if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort()) || Object.entries(expected).some(([key, value]) => actual[key] !== value)) {
      throw new Error(`Unexpected offline request parameters: ${url.pathname}`);
    }
  }

  async function offlineFetch(input) {
    const url = new URL(input, previewLocation.origin);
    if (url.origin !== previewLocation.origin) throw new Error(`Unmodeled offline request origin: ${url.origin}`);
    requests.push(url.pathname);
    if (url.pathname === '/fapi/v1/time') {
      requireParams(url, {});
      return new Response(JSON.stringify({ serverTime: Date.now() }), { headers: { 'Content-Type': 'application/json' } });
    }
    const endpoint = url.pathname.split('/').at(-1);
    if (!Object.hasOwn(dataset, endpoint)) throw new Error(`Unmodeled offline request: ${url.pathname}`);
    if (endpoint === 'fundingRate') {
      if (url.pathname !== '/fapi/v1/fundingRate') throw new Error('Invalid funding history path');
      requireParams(url, { symbol: 'BTCUSDT', limit: '40' });
    } else if (endpoint === 'premiumIndex') {
      if (url.pathname !== '/fapi/v1/premiumIndex') throw new Error('Invalid current funding path');
      requireParams(url, { symbol: 'BTCUSDT' });
    } else if (endpoint === 'fundingInfo') {
      if (url.pathname !== '/fapi/v1/fundingInfo') throw new Error('Invalid funding interval path');
      requireParams(url, {});
    } else if (endpoint === 'basis') {
      if (url.pathname !== '/futures/data/basis') throw new Error('Invalid basis path');
      requireParams(url, { pair: 'BTCUSDT', period: '5m', limit: '30', contractType: 'PERPETUAL' });
    } else {
      if (url.pathname !== `/futures/data/${endpoint}`) throw new Error('Invalid history path');
      requireParams(url, { symbol: 'BTCUSDT', period: '5m', limit: '30' });
    }
    return new Response(JSON.stringify(dataset[endpoint]), { headers: { 'Content-Type': 'application/json' } });
  }

  function offlineCmc(options) {
    if (options.method !== 'GET' || options.timeout !== 20_000) throw new Error('Invalid offline GM request');
    const url = new URL(options.url);
    if (!/^\d+$/.test(url.searchParams.get('_'))) throw new Error('Missing CMC request timestamp');
    url.searchParams.delete('_');
    requests.push(url.pathname);
    let response;
    if (url.origin === 'https://api.coinmarketcap.com' && url.pathname === '/data-api/v1/cryptocurrency/map') {
      requireParams(url, { symbol: 'BTC', listing_status: 'active' });
      response = { data: [{ id: 1, symbol: 'BTC', slug: 'bitcoin', is_active: 1 }] };
    } else if (url.origin === 'https://api.coinmarketcap.com' && url.pathname === '/data-api/v3/cryptocurrency/detail') {
      requireParams(url, { id: '1', convertId: '2781', languageCode: 'zh' });
      response = { data: detail };
    } else if (url.origin === 'https://dapi.coinmarketcap.com' && url.pathname === '/dex-stats/v3/dexer/crypto-holder/show_holders') {
      requireParams(url, { cryptoId: '1' });
      response = { data: { showFlag: true, count: 10_000 } };
    } else {
      throw new Error(`Unmodeled offline CMC request: ${url.origin}${url.pathname}`);
    }
    queueMicrotask(() => options.onload({ status: 200, responseText: JSON.stringify(response) }));
  }

  // All data boundaries are local, and links cannot navigate this review fixture externally.
  document.addEventListener('click', event => {
    if (event.target.closest('a[href]')) event.preventDefault();
  }, { capture: true });
  for (const artifact of artifacts) {
    const name = artifact.name === 'binance-trading-data' ? 'trading' : 'cmc';
    if (selection !== 'both' && selection !== name) continue;
    const run = new Function('location', 'fetch', 'GM_xmlhttpRequest', 'localStorage', artifact.source);
    run(previewLocation, offlineFetch, offlineCmc, previewStorage);
  }
}

const payload = { anchor, dataset, detail: cmcDetail(), artifacts };
const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' about:; connect-src 'none'; form-action 'none'">
  <title>Data panels · Offline implementation preview</title>
  <style>
    :root { color-scheme: light; font: 14px/1.5 system-ui, -apple-system, sans-serif; background: #f0f2f5; color: #202630; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; }
    body[data-theme="dark"] { background: #0b0e11; color: #eaecef; color-scheme: dark; }
    .toolbar { display: flex; align-items: center; gap: 12px 20px; flex-wrap: wrap; padding: 16px 20px; background: #fff; border-bottom: 1px solid #dde2e9; }
    [data-theme="dark"] .toolbar { background: #1e2329; border-color: #353d48; }
    h1 { margin: 0; font-size: 18px; font-weight: 650; }
    .heading { margin-right: auto; }
    .badge { display: inline-block; color: #996600; background: #fff4cf; border-radius: 4px; padding: 1px 6px; font-size: 12px; }
    [data-theme="dark"] .badge { color: #f0c96c; background: #453b20; }
    .versions { margin-top: 4px; color: #667185; font-size: 12px; }
    [data-theme="dark"] .versions { color: #a6b0bf; }
    label { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    select, button { font: inherit; padding: 6px 9px; border: 1px solid #b7c1d1; border-radius: 5px; background: transparent; color: inherit; }
    button { cursor: pointer; }
    .help { margin: 0; padding: 10px 20px; color: #667185; font-size: 12px; }
    [data-theme="dark"] .help { color: #a6b0bf; }
    iframe { display: block; width: 100%; height: calc(100vh - 144px); min-height: 600px; border: 0; background: transparent; }
    @media (max-width: 600px) { .toolbar { gap: 10px; padding: 12px; } .heading { flex: 1 0 100%; } h1 { font-size: 16px; } .help { padding: 9px 12px; } iframe { height: calc(100vh - 195px); } }
  </style>
</head>
<body data-theme="light">
  <header class="toolbar">
    <div class="heading"><h1 id="heading">数据面板实现预览 <span class="badge" id="example">示例数据</span></h1><div class="versions">Trading ${artifacts[0].version} · CMC ${artifacts[1].version}</div></div>
    <label><span id="language-label">语言</span><select id="locale" aria-label="Language"><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
    <label><span id="theme-label">主题</span><select id="theme" aria-label="Theme"><option value="light">浅色</option><option value="dark">深色</option></select></label>
    <label><span id="panel-label">面板</span><select id="selection" aria-label="Panels"><option value="both">两个面板</option><option value="trading">交易数据</option><option value="cmc">CMC 数据</option></select></label>
    <button id="reset" type="button">重置预览</button>
  </header>
  <p class="help" id="help">使用实际生成脚本与离线示例数据。可拖动、收起、查看历史点；不会连接交易所。切换选项会重置预览。</p>
  <iframe id="preview-frame" title="Offline data panel preview"></iframe>
  <script type="application/json" id="preview-payload">${safeJson(payload)}</script>
  <script>
    const payload = JSON.parse(document.getElementById('preview-payload').textContent);
    const bootstrap = ${bootPreview.toString()};
    const frame = document.getElementById('preview-frame');
    const localeControl = document.getElementById('locale');
    const themeControl = document.getElementById('theme');
    const selectionControl = document.getElementById('selection');
    function renderPreview() {
      const locale = localeControl.value;
      const english = locale === 'en';
      document.documentElement.lang = locale;
      document.body.dataset.theme = themeControl.value;
      document.getElementById('heading').firstChild.textContent = english ? 'Data panel implementation preview ' : '数据面板实现预览 ';
      document.getElementById('example').textContent = english ? 'Example data' : '示例数据';
      document.getElementById('language-label').textContent = english ? 'Language' : '语言';
      document.getElementById('theme-label').textContent = english ? 'Theme' : '主题';
      document.getElementById('panel-label').textContent = english ? 'Panels' : '面板';
      themeControl.options[0].textContent = english ? 'Light' : '浅色';
      themeControl.options[1].textContent = english ? 'Dark' : '深色';
      selectionControl.options[0].textContent = english ? 'Both panels' : '两个面板';
      selectionControl.options[1].textContent = english ? 'Trading data' : '交易数据';
      selectionControl.options[2].textContent = english ? 'CMC data' : 'CMC 数据';
      document.getElementById('reset').textContent = english ? 'Reset preview' : '重置预览';
      document.getElementById('help').textContent = english
        ? 'Actual generated scripts with offline example data. Drag, collapse or inspect history; no exchange connection is made. Changing an option resets the preview.'
        : '使用实际生成脚本与离线示例数据。可拖动、收起、查看历史点；不会连接交易所。切换选项会重置预览。';
      const configuration = JSON.parse(JSON.stringify({ ...payload, locale, theme: themeControl.value, selection: selectionControl.value }));
      frame.onload = () => {
        const run = frame.contentWindow.Function('configuration', '(' + bootstrap.toString() + ')(configuration)');
        run(configuration);
      };
      frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><title>Offline data panels</title></head><body></body></html>';
    }
    for (const control of [localeControl, themeControl, selectionControl]) control.addEventListener('change', renderPreview);
    document.getElementById('reset').addEventListener('click', renderPreview);
    renderPreview();
  </script>
</body>
</html>
`;

await mkdir(output, { recursive: true });
await writeFile(new URL('index.html', output), html);
await writeFile(new URL('manifest.json', output), JSON.stringify({
  kind: 'offline-example-data-preview', generatedAt: new Date().toISOString(),
  artifacts: artifacts.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
}, null, 2) + '\n');
console.log(fileURLToPath(new URL('index.html', output)));
