# Strategy31 volume reversal signals

Source: `src/binance-strategy31-volume-reversal/`. Installer:
`scripts/binance-strategy31-volume-reversal.user.js` (0.1.0).
Install alongside CorsairQuant signal client 0.6.6, which owns private gateway
authentication. The shared bridge explicitly advertises the `strategy31` capability.

CorsairQuant confirms consecutive closed red/green candles when green base volume
strictly exceeds red base volume. This client reads native chart candle times
only to limit rendering to loaded history; it does not detect signals locally.
It requests a bounded snapshot of up to 200 retained
events for the current canonical symbol and native timeframe every five seconds.
Hidden documents suspend requests; navigation and settings revisions invalidate
late responses. Repeated snapshots reconcile one arrow per stable event ID.
Interval changes preserve the native data-completion subscription. Unsupported
periods and non-USDT markets pause observation until a supported chart is selected.
A transient native candle snapshot inconsistency retains existing arrows and
waits for the next sample; malformed signal contracts still stop the observer.
Loading earlier
chart history makes matching retained server events eligible for rendering.

The client uses the existing native marker layer, exact interval visibility,
readback and drawing-save coordination. The green arrow anchors at the green
candle's open time and low. No exchange/account API or trading action is called.
The projection is recent retained history, not all visible chart history.

The shared capability permits only `/v1/strategy31/events` with exactly `symbol`,
`timeframe` and `limit=200`. It does not expose credentials or an arbitrary URL
proxy. Server contract uses schema 1 and `31_2_spec_v1`. Invalid event identity,
coordinates or numeric values stop this observer with a visible status.

Build with `npm run build:binance-strategy31-volume-reversal`; validate with
`npm run lint:tests`, `npm test`, `npm run check:binance-userscripts` and the
repository's browser suite. DOM integration tests use the shared native host
fixture, exercising actual marker rendering and stale-response rejection.
Fixture results do not establish current Binance rendering or installed code.
