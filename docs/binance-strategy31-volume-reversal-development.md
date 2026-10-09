# Strategy31 volume reversal signals

Source: `src/binance-strategy31-volume-reversal/`. Installer:
`scripts/binance-strategy31-volume-reversal.user.js` (0.1.8).
Install alongside CorsairQuant signal client 0.6.14, which owns private gateway
authentication. The shared bridge explicitly advertises the `strategy31` capability.

CorsairQuant confirms consecutive closed red/green candles when green base volume
has percentage growth strictly above the configured server-side
`signal_conditions.minimum_volume_growth_percent` (20% as shipped), with positive
red volume. Exactly 20% does not qualify at that threshold. The monitor publishes
the startup policy in SQLite; the gateway uses that policy for retained events.
Configuration changes require monitor restart and do not backfill previously
discarded candles. Signal periods start at 15m; the shipped monitor observes
15m, 30m, 1h and 4h. Telegram period exclusions are separate and only mute delivery
for otherwise supported signals. The shipped exclusion list is empty.
This client reads native chart candle times
only to limit rendering to loaded history; it does not detect signals locally.
It requests a bounded snapshot of up to 200 retained
qualifying events for the current canonical symbol and native timeframe every five seconds.
Hidden documents suspend requests; navigation and settings revisions invalidate
late responses. Repeated snapshots reconcile one arrow per stable event ID.
Interval changes preserve the native data-completion subscription. Unsupported
periods and non-USDT markets pause observation until a supported chart is selected.
On 1m, 3m and 5m charts it shows the existing unsupported-period status and makes
no Strategy31 request or arrow. Switching from a supported period hides previous
arrows immediately; a late response cannot restore them. Returning to a supported
period resumes only after the native data-completion event. Other strategies keep
their own period contracts, including Strategy27's one-second chart.
Non-trading routes remove the status and retire pending requests and chart
ownership. Route observation remains available after a terminal failure to
remove presentation on departure and redraw retained status when the language
changes; it does not restart failed business work.
A `/zh-CN/` route displays Chinese status messages; other routes use English,
following the shared panel locale contract. Signal counts, unsupported markets
and intervals, client setup requirements, service availability, and terminal
failure notices retain both languages until rendering. SPA language changes
immediately redraw the retained status, including while hidden, while a request
is pending, or after terminal failure. This presentation update makes no request,
restarts no observer, and does not replace chart markers. Gateway and parser
diagnostics are not translated; the existing generic terminal failure message
remains the public error contract.
A transient native candle snapshot inconsistency retains existing arrows and
waits for the next sample; malformed signal contracts still stop the observer.

The status notice is independently draggable, with an opaque `#181A20` background
and light text. Without a saved position it appears 16 pixels from the left and
40 pixels above the bottom. Pointer release saves `{left, top}` under
`strategy31StatusPosition` through this script's private `GM_getValue` and
`GM_setValue` grants. The shared presentation module supplies code and styles;
it does not combine this view or its storage with Strategy27. Text and locale
updates retain the same drag owner and write no preference. Intrinsic width is
bounded by the viewport rather than the saved left offset, so shrinking the window
keeps readable text and the view in bounds. Route removal, disposal and unloading release pointer
capture and listeners; a language change cannot recreate a removed notice.

Loading earlier
chart history makes matching retained server events eligible for rendering.

The client shares Strategy29's script-owned SVG marker layer. Exact candle-time
readback and native time/price coordinate conversion keep each green arrow
anchored at the green candle's open time and low. Viewport events redraw the layer;
interval invalidation hides it immediately. Marker changes do not create native
drawings, emit drawing events or request chart saves. No exchange/account API or
trading action is called. See the Strategy29 development manual for the shared
projection and lifecycle contract.
The projection is recent retained history, not all visible chart history.

The shared capability permits only `/v1/strategy31/events` with exactly `symbol`,
`timeframe` and `limit=200`. Allowed periods are 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h,
1d, 3d and 1w; shorter periods are rejected before transport or event parsing.
It does not expose credentials or an arbitrary URL
proxy. Server contract uses schema 1 and `31_2_spec_v1` as stable wire identity;
runtime signal policy uses v18. The server filters before selecting the latest 200
matches and returns them chronologically. If the 10,000-candidate scan budget is
exceeded before filling the snapshot, the route returns 503 rather than silently
returning incomplete history. Invalid event identity,
coordinates or numeric values stop this observer with a visible status.

Build with `npm run build:binance-strategy31-volume-reversal`; validate with
`npm run lint:tests`, `npm test`, `npm run check:binance-userscripts` and the
repository's browser suite. DOM integration tests use the shared chart-coordinate host
fixture, exercising actual marker rendering and stale-response rejection.
Fixture results do not establish current Binance rendering or installed code.
The period-admission regressions cover unsupported startup, immediate hiding
during a pending request, late-response rejection and supported-period recovery.
Live validation must separately exercise 1m/3m/5m rejection, a pending 15m-to-5m
switch, supported 15m and longer charts, and unchanged Strategy27 one-second
activation using the installed source.
