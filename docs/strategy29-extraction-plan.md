# Strategy 29 Userscript Extraction

Status: local extraction implemented; automated validation and independent
read-only review passed. Not committed, released or installed.

## Goal

Extract the existing Bollinger/SMA60 observer from orderbook 2.7.198 into
`binance-strategy29-bollinger.user.js`. Keep closed-candle predicates, native
loaded-history coverage, second-through-week intervals, mirrored signals,
marker ownership and the existing performance budgets unchanged.

## Ownership

- Strategy29 owns detection, chart polling, session revisions, historical markers
  and observer diagnostics. Its entrypoint has no account or order operations.
- Orderbook owns trading, account/order UI and depth rendering. It publishes only
  a synchronous drawing-busy predicate for its existing operation owners.
- Shared page-context coordination owns save-controller identity and busy-owner
  registration. Independently bundled copies must use the same versioned slot on
  the exact native chart API and the same page-level owner registry. These slots
  contain no credentials, positions, quantities or order commands.
- Each script works alone. When both run, either injection order must produce
  one native save wrapper and preserve pre-action draining and abort behavior.
- Strategy27 remains unchanged; it does not opt into this coordination contract.

## Migration

Orderbook 2.7.199 removes embedded Bollinger behavior; Strategy29 starts at 0.1.0.
Install/update both together and reload the page. A running legacy orderbook
with embedded Bollinger diagnostics is an explicit conflict: the standalone
observer must refuse rendering and report the required update/disable action,
not operate a duplicate detector or delete foreign drawings. Duplicate standalone
injection must not create a second poller.

## Implementation and Validation

1. Move the detector byte-for-byte and relocate its tests; extract the monitor
   lifecycle into an independently testable Strategy29 module.
2. Move generic abort, chart-target and marker-save utilities to shared sources;
   replace module-local singleton identity with the page/API coordination contract.
3. Remove orderbook detector imports, timer, lifecycle and diagnostics; retain its
   existing transaction guards and pre-action save drains.
4. Add the independent entrypoint, route/visibility/page lifecycle, duplicate and
   legacy conflict behavior. Preserve existing marker and performance tests.
5. Add independently evaluated bundle tests for both load orders, either script
   alone, active-operation blocking, async save drain, duplicate injection and
   old/new conflict. Verify chart switches and interrupted cleanup.
6. Update build mapping, CI triggers, metadata/install contracts and manuals.
   Update the Strategy29 server oracle path without changing its detector hash.
7. Run focused and full tests, affected builds/syntax, deterministic browser tests,
   exact detector parity and an independent implementation review. Record live
   browser validation separately; no live acceptance from fixture-only tests.

## Non-Goals

No server runtime, remote panel, Telegram transport, changed thresholds, new data
requests, Strategy27 changes, release/merge, Tampermonkey installation or financial
actions are included in this local extraction step.

## Local Validation Record

- Full Node suite: 766/766 passed.
- Chromium fixture suite: 64/64 passed, including both generated-script load orders.
- Orderbook 2.7.199 and Strategy29 0.1.0 builds, Binance artifact syntax checks,
  metadata inspection and whitespace checks passed.
- Detector relocation is byte-identical to the orderbook baseline. The server
  oracle compared 5,368 prefixes, 27,938 signals and 3,000 indicator rows, covering
  all six signal types without changing the pinned SHA-256.
- Strategy29 server documentation/workflow checks and the updated release skill
  validator passed. The server runtime and notification integration remain pending.
- Independent implementation review found no new functional issues and reran
  77/77 Strategy29 tests. Its in-memory builds matched both generated artifacts;
  the reviewer performed no writes.
- The first new browser fixture run used a mismatched symbol and failed correctly;
  the fixture now uses its canonical symbol. No production guard was relaxed.
- Real Binance/Tampermonkey rendered behavior and loaded-source identity were not
  inspected in this local-only step. Fixture results are not live acceptance.
