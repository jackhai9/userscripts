import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataPanelHost, completeCmcData, cmcDetail } from '../helpers/data-media-migration-host.js';

for (const [symbol, expected] of [
  ['龙虾USDT', '龙虾'], ['币安人生USDC', '币安人生'], ['4USDT', '4'],
  ['1INCHUSDT', '1INCH'], ['1000PEPEUSDT', 'PEPE'], ['1000龙虾USDT', '龙虾'],
  ['1000000龙虾USDT', '龙虾'], ['10000001USDT', '10000001'],
]) {
  test(`user maps ${symbol} to the exact CMC asset ${expected}`, { timeout: 5_000 }, async t => {
    // Given the complete CMC entrypoint receives a Unicode or numeric futures route
    const host = createDataPanelHost(t, 'cmc', { path: `/futures/${symbol}` });
    // When the map and detail endpoints resolve that route's base asset
    await host.start();
    await completeCmcData(host, cmcDetail({ id: 42, symbol: expected }), { symbol: expected, slug: 'fixture-asset' });
    // Then the CMC request removes only supported multipliers and preserves asset identity
    const mapping = host.network.requests.find(request => request.url.pathname.endsWith('/map'));
    assert.equal(mapping.url.searchParams.get('symbol'), expected);
    assert.equal(host.element('symbol').textContent, `${expected} #1`);
  });
}
