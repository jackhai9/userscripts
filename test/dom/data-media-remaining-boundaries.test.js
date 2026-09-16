import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateTradingData, afterDataMediaResponseTurn, cmcDetail, completeCmcData,
  completeTradingBatch, createDataPanelHost, tradingDataset,
} from '../helpers/data-media-migration-host.js';
import { createMediaHost } from '../helpers/data-media-migration-media-host.js';

const courseUrl = 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/';
const indexUrl = 'https://www.brookstradingcourse.com/main-course-videos/';
const exportStateKey = 'jh-userscripts:brooks-media-index-export';

async function completeInitialPanel(host, kind) {
  if (kind === 'trading') await activateTradingData(host);
  else await completeCmcData(host);
  await afterDataMediaResponseTurn();
}

/** Release HTTP fixture responses without requiring a mounted render target. */
async function respondCmcDetail(host, detail) {
  const request = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/detail'));
  request.respond({ data: detail });
  const holders = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/show_holders'));
  holders.respond({ data: { showFlag: true, count: 10_000 } });
  await afterDataMediaResponseTurn();
}

function detachOutputSlots(host, kind) {
  return (kind === 'trading' ? ['symbol', 'rows', 'composite', 'footer'] : ['symbol', 'rows', 'footer']).map(suffix => {
    const element = host.element(suffix);
    const parent = element.parentNode;
    const html = element.innerHTML;
    element.remove();
    return { element, parent, html };
  });
}

for (const kind of ['trading', 'cmc']) {
  test(`user restores current ${kind} values after page changes temporarily detach all output slots`, { timeout: 5_000 }, async t => {
    // Given a complete panel has its output elements detached by a page DOM update
    const host = createDataPanelHost(t, kind);
    await host.start();
    await completeInitialPanel(host, kind);
    const panel = host.panel();
    const detached = detachOutputSlots(host, kind);

    // When an ordinary refresh completes while those output elements are absent
    if (kind === 'trading') {
      host.setHidden(false);
      const time = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/time'));
      time.respond({ serverTime: Date.now() });
      await completeTradingBatch(host, tradingDataset(Date.now(), { oi: 3_000_000 }));
    } else {
      host.element('refresh').click();
      await respondCmcDetail(host, cmcDetail({ statistics: { ...cmcDetail().statistics, price: 70_000 } }));
    }
    await afterDataMediaResponseTurn();
    host.clock.tick(1_000);

    // Then detached output remains untouched and available header controls keep working
    assert.deepEqual(detached.map(({ element }) => element.innerHTML), detached.map(({ html }) => html));
    assert.equal(host.panel(), panel);
    assert.deepEqual(host.errors, []);
    host.element('collapse').click();
    assert.equal(host.element('body').style.display, 'none');

    // When the page restores its elements and the next refresh supplies new current values
    for (const { element, parent } of detached) parent.append(element);
    host.element('collapse').click();
    if (kind === 'trading') {
      host.setHidden(false);
      await activateTradingData(host, tradingDataset(Date.now(), { oi: 4_000_000 }));
    } else {
      host.element('refresh').click();
      await completeCmcData(host, cmcDetail({ statistics: { ...cmcDetail().statistics, price: 80_000 } }), { map: false });
    }
    await afterDataMediaResponseTurn();

    // Then the restored panel renders the newest response with one mounted panel and no stale mutation
    assert.equal(host.element('body').style.display, 'block');
    assert.equal(host.document.querySelectorAll(`#${host.panelId}`).length, 1);
    assert.match(host.element('rows').textContent, kind === 'trading' ? /4\.00M ▲/ : /价格\$8万/);
    assert.match(host.element('footer').textContent, kind === 'trading' ? /更新于/ : /CMC data-api/);
    assert.deepEqual(host.errors, []);
  });

  for (const viewport of [
    { name: 'document client dimensions', clientWidth: 640, clientHeight: 360 },
    { name: 'an unavailable viewport', clientWidth: 0, clientHeight: 0 },
  ]) {
    test(`user retains a finite ${kind} panel position with ${viewport.name}`, { timeout: 5_000 }, async t => {
      // Given window dimensions are temporarily zero while the document reports the specified viewport
      const prefix = kind === 'trading' ? 'jh_binance_trading_data' : 'jh_binance_cmc_data';
      const host = createDataPanelHost(t, kind, { storage: { [`${prefix}_pos`]: '{"left":900,"top":900}' } });
      Object.defineProperties(host.window, { innerWidth: { value: 0, configurable: true }, innerHeight: { value: 0, configurable: true } });
      Object.defineProperties(host.document.documentElement, {
        clientWidth: { value: viewport.clientWidth, configurable: true },
        clientHeight: { value: viewport.clientHeight, configurable: true },
      });

      // When the entrypoint renders and receives resize notifications before and after route removal
      await host.start();
      await completeInitialPanel(host, kind);
      host.window.dispatchEvent(new host.window.Event('resize'));
      const position = JSON.parse(host.window.localStorage.getItem(`${prefix}_pos`));
      const panelPosition = { left: host.panel().style.left, top: host.panel().style.top };
      host.navigate('/zh-CN/futures');
      host.window.dispatchEvent(new host.window.Event('resize'));

      // Then real JSDOM zero-area layout persists finite origin coordinates and removal creates no replacement
      assert.deepEqual(position, { left: 0, top: 0 });
      assert.deepEqual(panelPosition, { left: '0px', top: '0px' });
      assert.equal(host.panel(), null);
      assert.equal(host.window.localStorage.getItem(`${prefix}_pos`), '{"left":0,"top":0}');
      assert.deepEqual(host.errors, []);
    });
  }

  test(`user keeps one scheduled ${kind} refresh after a repeated visible notification`, { timeout: 5_000 }, async t => {
    // Given the panel is already visible with an active route watcher and business schedule
    const host = createDataPanelHost(t, kind);
    await host.start();
    await completeInitialPanel(host, kind);

    // When a repeated browser visibility event refreshes the still-active panel
    host.setHidden(false);
    if (kind === 'trading') await activateTradingData(host);
    else await completeCmcData(host, cmcDetail(), { map: false });
    await afterDataMediaResponseTurn();
    const count = host.network.requests.length;
    const deadline = kind === 'trading' ? 305_000 : 30_000;
    host.clock.tick(deadline - 1);
    assert.equal(host.network.requests.length, count);
    host.clock.tick(1);
    if (kind === 'trading') await completeTradingBatch(host, tradingDataset(Date.now()));
    else await respondCmcDetail(host, cmcDetail());
    await afterDataMediaResponseTurn();

    // Then the next deadline issues one batch and retains exactly one current panel
    assert.equal(host.network.requests.length, count + (kind === 'trading' ? 7 : 2));
    assert.equal(host.document.querySelectorAll(`#${host.panelId}`).length, 1);
    assert.equal(host.element('symbol').textContent, kind === 'trading' ? 'BTCUSDT' : 'BTC #1');
    assert.deepEqual(host.errors, []);
  });
}

test('user recovers a CMC panel after both API and page errors arrive while output slots are detached', { timeout: 5_000 }, async t => {
  // Given the current panel was rendered before the page removed its output slots
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  await completeCmcData(host);
  const detached = detachOutputSlots(host, 'cmc');

  // When a manual refresh receives failures from the API and its page-snapshot recovery boundary
  host.element('refresh').click();
  const api = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/detail'));
  api.respond({}, 503);
  const page = await host.network.waitForRequest(request => request.url.hostname === 'coinmarketcap.com');
  page.respond('Unavailable', 502);
  await afterDataMediaResponseTurn();

  // Then neither failed response writes into detached slots or destroys working controls
  assert.deepEqual(detached.map(({ element }) => element.innerHTML), detached.map(({ html }) => html));
  assert.equal(host.element('refresh').isConnected, true);
  assert.deepEqual(host.errors, []);

  // When the page restores its outputs and the next manual refresh succeeds
  for (const { element, parent } of detached) parent.append(element);
  host.element('refresh').click();
  await completeCmcData(host, cmcDetail(), { map: false });
  await afterDataMediaResponseTurn();

  // Then current rows and API provenance replace the former detached output
  assert.equal(host.element('symbol').textContent, 'BTC #1');
  assert.match(host.element('rows').textContent, /价格\$6万/);
  assert.equal(host.element('footer').querySelector('a').textContent, 'CMC data-api');
});

test('user receives an asset identification error when CMC supplies a numeric symbol instead of its string contract', { timeout: 5_000 }, async t => {
  // Given a numeric-only Binance asset has a current-symbol CMC map request
  const host = createDataPanelHost(t, 'cmc', { path: '/futures/4USDT' });
  await host.start();
  const request = await host.network.waitForRequest(request => request.url.pathname.endsWith('/map'));

  // When the upstream row has a numeric symbol even though its ID and slug are present
  request.respond({ data: [{ id: 4, symbol: 4, slug: 'four', is_active: 1 }] });
  await host.rendered(() => host.element('rows').textContent.includes('无法识别当前合约'));

  // Then invalid mapping data remains a visible failure and never triggers a guessed detail request
  assert.equal(host.element('rows').textContent, '读取失败无法识别当前合约');
  assert.equal(host.element('symbol').textContent, '4USDT');
  assert.equal(host.network.requests.length, 1);
});

test('user keeps trading data operational when the page temporarily has no head element', { timeout: 5_000 }, async t => {
  // Given the page body survives a host DOM update that removes its head
  const host = createDataPanelHost(t, 'trading');
  host.document.head.remove();

  // When the entrypoint creates its panel and completes the current-symbol data requests
  await host.start();
  await activateTradingData(host);

  // Then style installation uses the remaining document root and complete indicators remain usable
  assert.equal(host.document.getElementById('jh-trading-data-flash-style').parentNode, host.document.documentElement);
  assert.equal(host.element('rows').children.length, 8);
  assert.match(host.element('composite').textContent, /偏多 7:0/);
  assert.deepEqual(host.errors, []);
});

test('user sees unavailable trading data after the bounded retry also fails without an error message', { timeout: 5_000 }, async t => {
  // Given the current open-interest request rejects with an Error whose message is empty
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  host.network.requests[0].respond({ serverTime: Date.now() });
  await host.network.waitForRequest(request => request.url.pathname.endsWith('/fundingRate'));
  const dataset = tradingDataset(Date.now());
  const missing = host.network.requests.find(request => request.url.pathname.endsWith('/openInterestHist'));
  const failure = new Error('');

  // When its allowed retry also fails while all other data endpoints complete
  missing.fail(failure);
  for (const request of host.network.requests.filter(request => !request.settled)) {
    request.respond(dataset[request.url.pathname.split('/').at(-1)]);
  }
  const retry = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/openInterestHist'));
  retry.fail(failure);
  await host.rendered(panel => panel?.querySelector('[data-role="updated-at"]')?.textContent.startsWith('更新于'));

  // Then the missing row cannot vote and the complete error object remains available for diagnosis
  assert.equal(host.element('rows').firstElementChild.children[1].textContent, '--');
  assert.match(host.element('composite').textContent, /偏多 6:0/);
  assert.equal(host.network.requests.filter(request => request.url.pathname.endsWith('/openInterestHist')).length, 2);
  assert.equal(host.errors.at(-1).at(-1), failure);
});

test('user records a valid untitled Bunny detection without inventing its missing referer or title', { timeout: 5_000 }, async t => {
  // Given the exporter has loaded an untitled current course into its actual media iframe
  const host = createMediaHost(t, { url: indexUrl, markup: `<a href="${courseUrl}">Lesson</a>` });
  await host.start();
  host.element('brooks-media-export-primary').click();
  host.network.requests[0].respond('<iframe src="https://iframe.mediadelivery.net/embed/123/video-id"></iframe>');
  const frame = host.document.querySelector('iframe');

  // When that frame reports a supported playlist without optional title or referer metadata
  host.window.dispatchEvent(new host.window.MessageEvent('message', {
    source: frame.contentWindow, origin: 'https://iframe.mediadelivery.net',
    data: { type: 'jh-userscripts:m3u8-detected', url: 'https://media.example/video-id/playlist.m3u8', brooksExport: { pageUrl: courseUrl } },
  }));
  await afterDataMediaResponseTurn();
  host.element('brooks-media-export-download').click();
  const payload = JSON.parse(await host.downloads[0].blob.text());

  // Then the original course index completes with empty optional fields and correct media identities
  assert.equal(payload.completed, true);
  assert.deepEqual(payload.records.map(record => ({ index: record.index, title: record.title, mediaTitle: record.mediaTitle, referer: record.referer, videoId: record.videoId })), [
    { index: 0, title: '', mediaTitle: '', referer: '', videoId: 'video-id' },
  ]);
  assert.equal(payload.records[0].cn, 'https://media.example/video-id/captions/CN.vtt');
  assert.equal(payload.records[0].en, 'https://media.example/video-id/captions/EN.vtt');
  assert.equal(host.network.requests.length, 1);
  assert.equal(host.document.querySelectorAll('iframe').length, 0);
});

test('user gets an explicit failed course record for an empty successful HTML response', { timeout: 5_000 }, async t => {
  // Given collection is waiting for one authenticated-course HTML response
  const host = createMediaHost(t, { url: indexUrl, markup: `<a href="${courseUrl}">Lesson</a>` });
  await host.start();
  host.element('brooks-media-export-primary').click();

  // When the HTTP request succeeds but contains no page content
  host.network.requests[0].respond('');
  await afterDataMediaResponseTurn();
  const state = JSON.parse(host.window.localStorage.getItem(exportStateKey));

  // Then empty content remains a recoverable embed-discovery failure with the original course identity
  assert.deepEqual(state.failures, [{ ok: false, index: 0, url: courseUrl, error: 'Bunny embed iframe not found' }]);
  assert.deepEqual(state.records, []);
  assert.equal(state.running, false);
  assert.equal(host.element('brooks-media-export-retry-failed').style.display, '');
  assert.equal(host.document.querySelectorAll('iframe').length, 0);
});

test('user does not start a retry when saved failures have no valid original course index', { timeout: 5_000 }, async t => {
  // Given a completed saved collection contains a failure referring outside its original link list
  const saved = {
    schemaVersion: 2, links: [courseUrl], index: 1, records: [],
    failures: [{ ok: false, index: 9, url: courseUrl, error: 'Interrupted import' }],
    running: false, stopped: false, activeElapsedMs: 2_000,
  };
  const host = createMediaHost(t, { url: indexUrl, markup: `<a href="${courseUrl}">Lesson</a>`, storage: { [exportStateKey]: JSON.stringify(saved) } });
  await host.start();

  // When the user invokes the visible retry action for the saved failures
  host.element('brooks-media-export-retry-failed').click();
  await afterDataMediaResponseTurn();

  // Then no unrelated course request starts and the failure remains available for inspection
  assert.equal(host.network.requests.length, 0);
  assert.deepEqual(JSON.parse(host.window.localStorage.getItem(exportStateKey)), saved);
  assert.match(host.element('brooks-media-export-status').textContent, /最近失败: Interrupted import/);
});

test('user completes export after page changes remove optional action controls', { timeout: 5_000 }, async t => {
  // Given one pending course keeps its status display while the host removes optional controls
  const host = createMediaHost(t, { url: indexUrl, markup: `<a href="${courseUrl}">Lesson</a>` });
  await host.start();
  host.element('brooks-media-export-primary').click();
  for (const suffix of ['primary', 'retry-failed', 'download', 'reset', 'reset-help']) host.element(`brooks-media-export-${suffix}`).remove();

  // When an empty response completes as a declared per-course failure
  host.network.requests[0].respond('');
  await afterDataMediaResponseTurn();

  // Then status and persisted progress still reflect that outcome without recreating removed controls
  assert.match(host.element('brooks-media-export-status').textContent, /已完成 1\/1 \| 成功 0 \| 失败 1/);
  assert.equal(JSON.parse(host.window.localStorage.getItem(exportStateKey)).failures[0].error, 'Bunny embed iframe not found');
  assert.equal(host.element('brooks-media-export-dom').querySelectorAll('button').length, 0);
});

test('user keeps export progress when the page removes the whole status panel during collection', { timeout: 5_000 }, async t => {
  // Given collection has already issued its original-course request
  const host = createMediaHost(t, { url: indexUrl, markup: `<a href="${courseUrl}">Lesson</a>` });
  await host.start();
  host.element('brooks-media-export-primary').click();

  // When the page removes the exporter UI before the network failure arrives
  host.element('brooks-media-export-dom').remove();
  host.network.requests[0].fail();
  await afterDataMediaResponseTurn();
  const state = JSON.parse(host.window.localStorage.getItem(exportStateKey));

  // Then the failure remains persisted and collection stops without silently recreating the removed UI
  assert.equal(host.element('brooks-media-export-dom'), null);
  assert.deepEqual(state.failures, [{ ok: false, index: 0, url: courseUrl, error: 'page fetch network error' }]);
  assert.equal(state.running, false);
  assert.equal(host.network.requests.length, 1);
});
