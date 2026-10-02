# Binance Futures startup stall observed on 2026-10-02

This is incident evidence, not a standing diagnosis or permission to change a
browser profile. The assistant performed no refresh, extension change, cache
deletion, proxy change, or trading action during the investigation.

## Page purpose

`/zh-CN/futures/` is a real contract-entry route. The observed Binance application
registers `futures` with route ID `743f`. Its page module delegates to module
`41906`, which selects a valid previous UM contract or defaults to `BTCUSDT`.
An indefinitely empty page is not its intended final state.

Sources: [entry module](https://bin.bnbstatic.com/static/chunks/page-743f.ce7935bd.js),
[contract selection](https://bin.bnbstatic.com/static/chunks/78955.382ce295.js).
The precise downstream history push/replace implementation was not inspected.

## Observed failure and recovery

Both a concrete USUSDT trading page and the contract-entry page had HTTP 200
documents and completed load events, but remained in startup. The router was
not ready, its transition remained pending, and the trading page had no native
orderbook or chart container. A small userscript panel does not establish host
application readiness.

The current [framework](https://bin.bnbstatic.com/static/common/framework.2922525e.js)
waits for route readiness before hydration. Its registered theme `beforeResolve`
hook records `get-cache-theme-config-start`, awaits configuration, then records
the end marker and advances the route. In the
[main bundle](https://bin.bnbstatic.com/static/main.37a180b9.js), module `99940`
first awaits a localForage cache read. A cache miss loads a theme JavaScript
chunk. The cache wait has no application-level deadline; webpack's separate
script loader does have a 120-second deadline.

The user subsequently reported that the pages had recovered. The currently
loaded documents contained the following timing records; values are milliseconds
from each document's navigation start:

| Document | Time origin | Event | Start | End |
| --- | --- | --- | ---: | ---: |
| USUSDT | 1790915945589.4 | Theme configuration | 924 | 1214752 |
| USUSDT | 1790915945589.4 | Language cache branch | 856 | 1214836 |
| Futures home | 1790915960355 | Language startup gate | 647 | 1200211 |

The USUSDT theme gate and home language gate ended about 225 ms apart in wall
time. USUSDT then had a ready router, native orderbook, chart container, and
canvas. A subsequent theme read took 5 ms. A fresh read-only
`indexedDB.databases()` metadata query completed in 3 ms and confirmed the theme
database existed, without reading its records.

Earlier, an IndexedDB metadata query remained pending at a subsequent check.
Intervening document navigations invalidated its remote object, so its eventual
outcome cannot be recovered or equated with the later successful query. These
samples span different document lifetimes; do not describe the entire session
as one uninterrupted navigation or claim that nobody refreshed it.

The strongest supported conclusion is a stalled theme/configuration route gate,
with browser-local storage readiness implicated by the concurrent cache waits
and recovery. The precise storage driver, blocking connection, rejected versus
pending internal theme operation, and browser defect remain unproven. A rejected
async hook that never calls its continuation can also leave a route pending.

## Network comparison

macOS HTTP, HTTPS, and SOCKS settings pointed to `127.0.0.1:7890`.
One bounded request for the exact main bundle through that proxy returned HTTP
200 in 0.904 seconds. A direct request timed out during connection establishment
after 15 seconds. These results establish only those two shell request paths;
they do not certify every browser request or exclude an earlier transient
network failure. There is no evidence here that disabling the proxy is a fix.

## Related upstream reports

- [localForage #821](https://github.com/localForage/localForage/issues/821)
  describes a first `getItem()` that never settles after cross-tab object-store
  changes. [PR #807](https://github.com/localForage/localForage/pull/807) fixed a
  connection/version-change problem. The maintainer
  [released 1.10.0](https://github.com/localForage/localForage/pull/807#issuecomment-901439908)
  and a reporter [confirmed the fix](https://github.com/localForage/localForage/pull/807#issuecomment-901563757).
  The observed Binance bundle already contains localForage 1.10.0 and
  `onversionchange` connection closing. Missing this old fix is not a supported
  explanation for the current incident.
- [#685](https://github.com/localForage/localForage/issues/685) reports silent
  `indexedDB.open()` hangs and community recovery after Chrome restart. Another
  reporter [found site-data clearing also unresponsive](https://github.com/localForage/localForage/issues/685#issuecomment-381134641).
  The [maintainer did not establish a root cause](https://github.com/localForage/localForage/issues/685#issuecomment-381339640).
- [#912](https://github.com/localForage/localForage/issues/912#issuecomment-883958597)
  contains a Chrome multi-tab pending-operation report. An earlier comment
  [associates clearing data across open tabs with a hang](https://github.com/localForage/localForage/issues/912#issuecomment-566066515).
  These are community observations, not confirmed remedies for Binance.
- [Chrome Page Lifecycle guidance](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
  recommends closing IndexedDB connections before freezing so other same-origin
  tabs are not affected. [MDN's blocked event documentation](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/blocked_event)
  explains version-change blocking. Neither proves a freeze or lock occurred here.

The cited GitHub discussions were inspected with their full comment threads,
follow-ups, and linked fix. Direct Binance Reddit threads were inaccessible
during this investigation and are not treated as verified supporting evidence.

## Next occurrence

Preserve the failed page, record document time origin and the route/cache marks,
and compare browser storage readiness with bounded network evidence before
changing settings. Collect from navigation start if the goal is to identify the
specific unresolved storage operation. Browser restart is a community recovery
experiment, not a proven durable fix; clearing site data is not the first step.
Do not patch Binance's router or call its continuation from a userscript.

The separate userscript bug was broad route recognition (`home` became `HOME`)
and Strategy31's non-trading status lifecycle. Fixing those defects does not
establish that the host startup stall is fixed.
