import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateTradingData, afterDataMediaResponseTurn, cmcDetail, completeCmcData,
  createDataPanelHost, isTradingHistoryRequest,
} from '../helpers/data-media-migration-host.js';

async function startTradingHistory(host) {
  const time = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/time'));
  time.respond({ serverTime: Date.now() });
  await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/fundingRate'));
  await afterDataMediaResponseTurn();
  return host.network.requests.filter(request => !request.settled && isTradingHistoryRequest(request));
}

function pageEvent(host, type) {
  host.window.dispatchEvent(new host.window.PageTransitionEvent(type, { persisted: true }));
}

async function startCmcStage(host, stage) {
  await host.start();
  const mapping = host.network.requests[0];
  if (stage === 'mapping') return mapping;
  mapping.respond({ data: [{ id: 1, symbol: 'BTC', slug: 'bitcoin', is_active: 1 }] });
  const detail = await host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/detail'));
  if (stage === 'detail') return detail;
  if (stage === 'page') {
    detail.fail('error');
    return host.network.waitForRequest(request => !request.settled && request.url.hostname === 'coinmarketcap.com');
  }
  assert.equal(stage, 'holders');
  detail.respond({ data: cmcDetail() });
  return host.network.waitForRequest(request => !request.settled && request.url.pathname.endsWith('/show_holders'));
}

test('user keeps only seven active historical requests through rapid symbol changes', { timeout: 5_000 }, async t => {
  // Given the first symbol has seven historical responses still pending
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const counts = [(await startTradingHistory(host)).length];

  // When two later symbols start before any historical endpoint responds
  for (const symbol of ['ETHUSDT', 'SOLUSDT']) {
    host.navigate(`/zh-CN/futures/${symbol}`);
    counts.push((await startTradingHistory(host)).length);
  }
  const history = host.network.requests.filter(isTradingHistoryRequest);

  // Then only the current symbol owns seven requests and older sessions are cancelled
  assert.deepEqual(counts, [7, 7, 7]);
  assert.equal(history.length, 21);
  assert.equal(history.filter(request => request.aborted).length, 14);
  assert.deepEqual(history.filter(request => !request.settled).map(request => request.url.searchParams.get('symbol') || request.url.searchParams.get('pair')), Array(7).fill('SOLUSDT'));
  assert.deepEqual(host.errors, []);

  // When the user leaves futures before the final batch completes
  host.navigate('/zh-CN/futures');
  host.clock.tick(60_000);
  await afterDataMediaResponseTurn();

  // Then no historical request or off-route retry remains active
  assert.equal(host.network.requests.filter(request => !request.settled).length, 0);
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 21);
  assert.equal(history.filter(request => request.aborted).length, 21);
  assert.deepEqual(host.errors, []);
});

test('user prevents a queued historical network failure from retrying after route departure', { timeout: 5_000 }, async t => {
  // Given every historical endpoint is awaiting its first response
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const history = await startTradingHistory(host);

  // When transport failures settle immediately before their route is invalidated
  history.forEach(request => request.fail());
  host.navigate('/zh-CN/futures');
  await afterDataMediaResponseTurn();
  host.clock.tick(60_000);

  // Then promise reactions create neither immediate retries nor provider-failure reports
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 7);
  assert.equal(host.network.requests.filter(request => !request.settled).length, 0);
  assert.deepEqual(host.errors, []);
});

test('user keeps historical requests alive through funding deadlines and tab hiding', { timeout: 5_000 }, async t => {
  // Given history, current funding, and interval metadata are all pending independently
  const host = createDataPanelHost(t, 'trading');
  await host.start();
  const history = await startTradingHistory(host);
  const quotes = host.network.requests.filter(request => /\/(premiumIndex|fundingInfo)$/.test(request.url.pathname));

  // When the page becomes hidden and both quote-specific deadlines elapse
  host.setHidden(true);
  host.clock.tick(10_000);
  await afterDataMediaResponseTurn();
  host.setHidden(false);

  // Then quote timeouts cancel only their own requests while the original history remains active
  assert.equal(quotes.length, 2);
  assert.equal(quotes.every(request => request.aborted), true);
  assert.equal(history.every(request => !request.settled && !request.aborted), true);
  assert.equal(host.network.requests.filter(isTradingHistoryRequest).length, 7);
});

for (const stage of ['mapping', 'detail', 'page', 'holders']) {
  for (const departure of ['route', 'close', 'pagehide']) {
    test(`user cancels the CMC ${stage} request on ${departure} without continuing its chain`, { timeout: 5_000 }, async t => {
      // Given the selected CMC pipeline stage is still waiting for its provider response
      const host = createDataPanelHost(t, 'cmc');
      const pending = await startCmcStage(host, stage);
      const count = host.network.requests.length;
      const rows = host.element('rows');
      const before = rows.innerHTML;

      // When the owning route, panel, or page becomes inactive
      if (departure === 'route') host.navigate('/zh-CN/futures');
      else if (departure === 'close') host.element('close').click();
      else pageEvent(host, 'pagehide');
      await afterDataMediaResponseTurn();
      host.clock.tick(60_000);

      // Then cancellation is terminal and cannot start a fallback, holder lookup, or refresh
      assert.equal(pending.aborted, true);
      assert.equal(pending.settled, true);
      assert.equal(host.network.requests.length, count);
      assert.equal(host.network.requests.filter(request => !request.settled).length, 0);
      assert.equal(rows.innerHTML, before);
      assert.deepEqual(host.errors, []);
    });
  }
}

for (const outcome of ['mapping success', 'detail failure', 'detail success']) {
  test(`user stops the CMC chain when ${outcome} is delivered after an unobserved pathname change`, { timeout: 5_000 }, async t => {
    // Given Binance retains its native history method while a CMC stage is pending
    const host = createDataPanelHost(t, 'cmc');
    const nativePushState = host.window.history.pushState;
    const pending = await startCmcStage(host, outcome === 'mapping success' ? 'mapping' : 'detail');
    const count = host.network.requests.length;

    // When the native route changes before its watchdog observes the provider completion
    nativePushState.call(host.window.history, {}, '', '/en/futures/ETHUSDT');
    if (outcome === 'mapping success') pending.respond({ data: [{ id: 1, symbol: 'BTC', slug: 'bitcoin', is_active: 1 }] });
    else if (outcome === 'detail failure') pending.fail('error');
    else pending.respond({ data: cmcDetail() });
    await afterDataMediaResponseTurn();

    // Then old-path completion cannot initiate detail, page fallback, or holder work
    assert.equal(host.network.requests.length, count);
    assert.equal(host.network.requests.filter(request => !request.settled).length, 0);
    assert.deepEqual(host.errors, []);
  });
}

for (const stage of ['detail', 'page']) {
  for (const outcome of ['success', 'HTTP rejection', 'network failure', 'timeout', 'abort', 'invalid body']) {
    test(`user releases the CMC ${stage} cancellation listener after ${outcome}`, { timeout: 5_000 }, async t => {
      // Given the refresh owns a pending transport with an abort listener
      const host = createDataPanelHost(t, 'cmc');
      const pending = await startCmcStage(host, stage);
      const count = host.network.requests.length;

      // When a terminal provider event is immediately followed by panel closure
      if (outcome === 'network failure') pending.fail('error');
      else if (outcome === 'timeout' || outcome === 'abort') pending.fail(outcome);
      else if (outcome === 'HTTP rejection') pending.respond('', 403);
      else if (outcome === 'invalid body') pending.respond('{invalid');
      else if (stage === 'detail') pending.respond({ data: cmcDetail() });
      else pending.respond(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { detailRes: { detail: cmcDetail() } } } })}</script>`);
      host.element('close').click();
      await afterDataMediaResponseTurn();

      // Then closing never calls abort on a completed transport or starts its next stage
      assert.equal(pending.abortCalls, 0);
      assert.equal(pending.settled, true);
      assert.equal(host.network.requests.length, count);
      assert.equal(host.network.requests.filter(request => !request.settled).length, 0);
      assert.deepEqual(host.errors, []);
    });
  }
}

test('user treats a provider-aborted CMC detail request as cancellation without a page fallback', { timeout: 5_000 }, async t => {
  // Given the mapping has completed and the detail transport is pending
  const host = createDataPanelHost(t, 'cmc');
  const pending = await startCmcStage(host, 'detail');
  const before = host.element('rows').innerHTML;

  // When Tampermonkey reports abort without a provider error or response
  pending.fail('abort');
  await afterDataMediaResponseTurn();

  // Then the request ends without provider failure UI or fallback traffic
  assert.equal(pending.aborted, true);
  assert.equal(host.network.requests.length, 2);
  assert.equal(host.network.requests.filter(request => !request.settled).length, 0);
  assert.equal(host.element('rows').innerHTML, before);
});

test('user cancels an older manual CMC refresh before starting its replacement', { timeout: 5_000 }, async t => {
  // Given the original asset mapping remains pending while Refresh stays available
  const host = createDataPanelHost(t, 'cmc');
  await host.start();
  const old = host.network.requests[0];

  // When manual Refresh supersedes the original attempt and visibility events follow
  host.element('refresh').click();
  host.setHidden(true);
  host.setHidden(false);
  await afterDataMediaResponseTurn();

  // Then only the replacement request stays active and no old chain continues
  assert.equal(old.aborted, true);
  assert.equal(host.network.requests.length, 2);
  assert.equal(host.network.requests.filter(request => !request.settled).length, 1);
  assert.equal(host.network.requests[1].aborted, false);
});

for (const kind of ['trading', 'cmc']) {
  for (const hidden of [false, true]) {
    test(`user resumes ${kind} once from BFCache with the restored page ${hidden ? 'hidden' : 'visible'}`, { timeout: 5_000 }, async t => {
      // Given an activated page still owns pending provider requests before entering BFCache
      const host = createDataPanelHost(t, kind);
      await host.start();
      if (kind === 'trading') await startTradingHistory(host);
      const old = host.network.requests.filter(request => !request.settled);
      const before = host.network.requests.length;
      host.setHidden(hidden);

      // When pagehide suspends the session and early visibility events arrive before pageshow
      pageEvent(host, 'pagehide');
      host.setHidden(false);
      host.setHidden(hidden);
      host.clock.tick(60_000);
      await afterDataMediaResponseTurn();

      // Then all pending transports are cancelled and suspension cannot restart business work
      assert.equal(old.every(request => request.aborted), true);
      assert.equal(host.network.requests.length, before);

      // When BFCache restoration and repeated page events identify the same page session
      pageEvent(host, 'pageshow');
      assert.equal(host.network.requests.length, before + 1);
      pageEvent(host, 'pageshow');
      host.setHidden(hidden);
      host.setHidden(false);
      await afterDataMediaResponseTurn();

      // Then exactly one restored calibration or mapping request belongs to the new session
      assert.equal(host.network.requests.length, before + 1);
      assert.equal(host.network.requests.filter(request => !request.settled).length, 1);
      assert.equal(host.network.requests.at(-1).url.pathname, kind === 'trading' ? '/fapi/v1/time' : '/data-api/v1/cryptocurrency/map');
      assert.deepEqual(host.errors, []);

      // When the restored session receives a complete current-symbol snapshot
      if (kind === 'trading') await activateTradingData(host);
      else await completeCmcData(host);
      await afterDataMediaResponseTurn();
      const completedCount = host.network.requests.length;
      host.clock.tick(kind === 'trading' ? 15_000 : 30_000);
      await afterDataMediaResponseTurn();

      // Then current data and exactly one scheduled foreground refresh resume normally
      assert.match(host.element('rows').textContent, kind === 'trading' ? /200万 ▲/ : /价格\$6万/);
      assert.equal(host.network.requests.length, completedCount + 1);
      assert.equal(host.network.requests.at(-1).url.pathname, kind === 'trading' ? '/fapi/v1/premiumIndex' : '/data-api/v3/cryptocurrency/detail');
    });
  }

  test(`user keeps a closed ${kind} panel closed through BFCache restoration`, { timeout: 5_000 }, async t => {
    // Given the panel has been explicitly closed with its initial request still pending
    const host = createDataPanelHost(t, kind);
    await host.start();
    host.element('close').click();
    const count = host.network.requests.length;

    // When the same document enters BFCache and later becomes visible again
    pageEvent(host, 'pagehide');
    pageEvent(host, 'pageshow');
    host.setHidden(true);
    host.setHidden(false);
    host.clock.tick(60_000);
    await afterDataMediaResponseTurn();

    // Then its closed state survives without any new provider request
    assert.equal(host.panel().style.display, 'none');
    assert.equal(host.network.requests.length, count);
    assert.equal(host.network.requests.filter(request => !request.settled).length, 0);
  });

  test(`user keeps a never-visited ${kind} page inactive when BFCache restores it hidden`, { timeout: 5_000 }, async t => {
    // Given the document has never activated its panel because it started hidden
    const host = createDataPanelHost(t, kind, { hidden: true });
    await host.start();

    // When BFCache restores the same document before its first visible visit
    pageEvent(host, 'pagehide');
    pageEvent(host, 'pageshow');
    pageEvent(host, 'pageshow');
    host.clock.tick(60_000);

    // Then hidden restoration leaves the panel and provider requests inactive
    assert.equal(host.panel(), null);
    assert.equal(host.network.requests.length, 0);

    // When the user first visits the restored page
    host.setHidden(false);
    pageEvent(host, 'pageshow');

    // Then that first visible activation starts just one initial provider request
    assert.equal(host.network.requests.length, 1);
    assert.equal(host.network.requests[0].url.pathname, kind === 'trading' ? '/fapi/v1/time' : '/data-api/v1/cryptocurrency/map');
  });
}
