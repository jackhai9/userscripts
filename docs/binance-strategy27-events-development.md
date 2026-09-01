# Binance Strategy 27 Event Annotations

## Purpose

`binance-strategy27-events.user.js` is a rendering client for the Strategy 27
V10 live projection. The VPS remains the only market-data and event-analysis
authority. The userscript opens no Binance market-data WebSocket, uses no
Binance API key, and does not recalculate the four force groups.

The script reads an authenticated, loopback-only long-poll endpoint through an
SSH local forward. It draws transient entities only when the Binance route,
TradingView symbol, and `1S` chart interval all match the requested Strategy 27
symbol.

## Operator Setup

1. Keep an SSH local forward open from `127.0.0.1:<local-port>` to the VPS
   Strategy 27 gateway on `127.0.0.1:8765`.
2. Install `scripts/binance-strategy27-events.user.js` in Tampermonkey.
3. Use the userscript menu to set the loopback gateway origin. The default is
   `http://127.0.0.1:18765`.
4. Use the userscript menu to set the gateway installation secret. Tampermonkey
   stores it in this script's private value storage; it is never embedded in
   source, URL parameters, chart text, console messages, or status text.
5. Open the matching Binance futures route and select the one-second chart.

## Rendering Contract

- `event_opened` creates one marker.
- `event_updated` updates that marker and the compact status strip without
  creating a note.
- `event_closed` creates or updates one objective note with the event interval,
  four-force facts, immediate price response, trigger reasons, and close reason.
- `event_outcome` updates that same note with the ordered outcome horizons.
- Incomplete or input-gap facts are marked as incomplete and carry no
  directional conclusion.

Every created entity uses the second obtained by flooring the projection's
`event_time_ms`. The script reads the entity point back after each create or
update. If TradingView shifts the point to a different bar, the entity is
removed and visualization stops with an alignment error.

`triggered_at_ms` is the trigger bucket's start boundary. The browser requires
`trigger_snapshot.bucket_start_ms` to equal it; the bucket end remains the
exclusive end of that same measurement interval.

For a closed event, `latest_snapshot` is the last eligible event bucket retained
before closure. `event_closed.event_time_ms` carries `active_end_at_ms` and can
be later than that snapshot's end when an ineligible bucket advances the event
to its lifecycle deadline without joining the event.

The script stores only its own returned entity IDs. Route, symbol, interval,
epoch, cursor, or sequence discontinuities abort the request and remove only
those transient entities. Event count and age are bounded in memory and on the
chart.

## Development

Source lives under `src/binance-strategy27-events/`; the generated installable
artifact is `scripts/binance-strategy27-events.user.js`.

```bash
npm run test:binance-strategy27-events
npm run build:binance-strategy27-events
npm run check:binance-userscripts
node scripts/userscript-release-contract.mjs scripts/binance-strategy27-events.user.js
git diff --check
```

Live validation must confirm the current Binance main-world chart API, exact
`1S` resolution, exact route symbol, successful create/readback/remove behavior,
Tampermonkey source readback, and the actually loaded source after a hard
reload. A source-level method name alone is not end-to-end proof.
