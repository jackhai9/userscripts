# Public host persistence fixture

`host-persistence.js` executes the original Binance storage business functions
through the existing captured Rspack runtime and localForage module. It does not
reimplement lodash, the chart save algorithm, Basic storage, or mirroring.

`host-persistence-manifest.json` records each complete source file's public URL,
SHA-256 and byte count. Every copied declaration, callback and dependency factory
has its original UTF-16 range, the corresponding generated-fixture range and the
SHA-256 of the exact UTF-8-encoded slice. The generated registration wrapper and
each added `var`/`const` declaration delimiter sit outside those original ranges.
The browser helper checks the whole fixture and all fragment hashes before use.

The source inputs were obtained on 2026-10-06. The original investigation supplied
`main.37a180b9.js`, `28928.9aeec892.js`, `36648.dd8ae7dc.js` and
`TradingView.99bc5074.js`. A separate anonymous Chrome visit to the public USUSDT
page identified the missing lodash factories in chunks `40784`, `45485`, `16873`
and `56679`. Only those public JS responses were downloaded; extraction retains
only the required factories. No login, existing browser profile, storage values
or trading actions were used. Both anonymous browsers were closed in `finally`.
The current page selected Basic by default; selecting Trading View was unnecessary
to obtain these dependencies. A successful module observation is not UI evidence.

Regenerate from directories containing these public response bodies:

```sh
node test/fixtures/binance-chart-storage/host-persistence-extract.js \
  /path/to/original-public-chunks /path/to/additional-public-chunks
```

Acorn selects the host functions and recursively collects their original lexical
declarations. The extractor then collects original webpack dependency factories.
Missing declarations or dependencies are errors; no replacement implementation is
inserted. It does not download sources or read a browser profile.

## Executed contracts

- TradingView module `76535`: `kt`, `wt`, `xt`, `zt`, `Wt`, key helpers and the
  original `Tt` save callback. The test supplies storage, key, widget and onSave
  references to that unchanged callback. `onSave` is the original mirror callback.
- Basic module `15426`: `Wo`, `Dc`, default indicator data, key constructors,
  annotations conversion and the actual `Lc` old-key migration. Tests supply JSON
  data at this storage boundary. The upstream `Ec` React subscriptions, debounce,
  loading guard and JSON serialization are not executed by this fixture.
- TradingView mirror: the original compiled async callback, original SWC helpers,
  namespace constants and original lodash dependencies. The wrapper supplies the
  requested namespace and native enabled-state refs (`Cr.current=false`,
  `_r.current=true`). It does not simulate React lifecycle changes to those refs.
- The widget boundary implements only the `activeChartIndex()` call used by these
  storage functions. Chart rendering and the full TradingView widget are absent.

All scenarios run independently against native localForage and the adapter, using
fresh Chromium contexts, the same original functions and real IndexedDB. They
cover staged saves, the cross-database mirror, layout retention, restored drawings,
removing a symbol's last drawing, all six Basic keys, old-key migration and shared
store clearing. The save/mirror measurement excludes setup and final verification.
It measures transaction/request counts, not wall-clock speed or blank-page recovery.

The concurrent clear scenario records a real behavioral difference. In the
captured localForage IndexedDB driver, `setItem` creates its transaction in a
second `ready().then(...).then(...)` stage, while `clear` creates its transaction
in the first `ready().then(...)` stage. Simultaneously invoked sets can therefore
commit after a later-invoked clear. The adapter instead enforces issue order.
The shared-clear conformance scenario awaits existing saves before clearing;
the separate concurrency scenario explicitly asserts each implementation's
different result. Neither result establishes atomic behavior across databases.

These offline tests do not establish production injection, existing-profile data
compatibility, UI rendering, safety of stopping mounted callers, fallback-driver
behavior, cross-tab lost-update protection or cross-database atomicity.
