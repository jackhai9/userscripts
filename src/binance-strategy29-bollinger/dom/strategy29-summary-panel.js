import { STRATEGY29_REFERENCE_SHA256, STRATEGY29_SPEC_VERSION } from '../core/remote-summary-contract.js';

const PANEL_ID = 'jh-strategy29-summary-panel';
const STATE_COLORS = Object.freeze({
  connected: '#0ECB81',
  connecting: '#F0B90B',
  unavailable: '#F0B90B',
  disconnected: '#F6465D',
  stopped: '#F6465D',
  incompatible: '#F6465D',
  configuration_required: '#F0B90B',
});
const STATUS_COLORS = Object.freeze({
  ready: '#0ECB81',
  warming: '#F0B90B',
  stale: '#F6465D',
  insufficient_history: '#F0B90B',
  data_gap: '#F6465D',
  failed: '#F6465D',
});
const TYPE_LABELS = Object.freeze({
  'bearish:warning': 'Bearish warning',
  'bearish:confirmed': 'Bearish confirmed',
  'bearish:reversal': 'Long reversal',
  'bullish:warning': 'Bullish warning',
  'bullish:confirmed': 'Bullish confirmed',
  'bullish:reversal': 'Short reversal',
});
const CLOCK_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  timeZone: 'Asia/Shanghai',
});

function element(document, tagName, { text = '', role = null, styles = null } = {}) {
  const node = document.createElement(tagName);
  node.textContent = text;
  if (role) node.dataset.role = role;
  if (styles) Object.assign(node.style, styles);
  return node;
}

function formatClock(timestampMs) {
  const date = new Date(timestampMs);
  const parts = CLOCK_FORMATTER.formatToParts(date);
  const part = name => parts.find(item => item.type === name)?.value;
  return `${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')} UTC+08`;
}

function signalLabel(event) {
  return TYPE_LABELS[`${event.setup_direction}:${event.signal_type}`];
}

export function createStrategy29SummaryPanel(document, canonicalSymbol, { maxEvents = 20 } = {}) {
  if (!document?.body) throw new Error('Strategy 29 summary panel requires document.body');
  if (typeof canonicalSymbol !== 'string' || canonicalSymbol.length === 0) throw new Error('Strategy 29 panel symbol is invalid');
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 100) throw new Error('Strategy 29 panel maxEvents is invalid');
  document.getElementById(PANEL_ID)?.remove();

  const panel = element(document, 'section', {
    styles: {
      position: 'fixed', zIndex: '999995', top: '68px', right: '84px', width: '340px',
      boxSizing: 'border-box',
      maxWidth: 'calc(100vw - 112px)', maxHeight: 'calc(100vh - 92px)', overflow: 'hidden',
      border: '1px solid rgba(132,142,156,.30)', borderRadius: '9px',
      background: 'rgba(24,26,32,.96)', boxShadow: '0 5px 18px rgba(0,0,0,.30)',
      color: '#EAECEF', font: '12px/17px BinancePlex,ui-sans-serif,system-ui,sans-serif',
      pointerEvents: 'auto', userSelect: 'none',
    },
  });
  panel.id = PANEL_ID;
  const header = element(document, 'header', {
    styles: { display: 'flex', alignItems: 'center', gap: '7px', padding: '8px 10px', borderBottom: '1px solid rgba(132,142,156,.20)' },
  });
  header.appendChild(element(document, 'strong', { text: 'Strategy 29 Summary', styles: { flex: '1', fontSize: '13px' } }));
  const collapse = element(document, 'button', {
    text: 'Collapse', role: 'collapse',
    styles: { border: '0', borderRadius: '5px', padding: '2px 7px', background: 'rgba(132,142,156,.18)', color: '#EAECEF', cursor: 'pointer' },
  });
  collapse.type = 'button';
  header.appendChild(collapse);
  const body = element(document, 'div', { role: 'body', styles: { maxHeight: 'calc(100vh - 150px)', overflow: 'auto' } });
  const overview = element(document, 'div', { styles: { display: 'grid', gap: '4px', padding: '9px 10px' } });
  overview.appendChild(element(document, 'div', { text: canonicalSymbol, role: 'symbol', styles: { fontWeight: '700' } }));
  const connection = element(document, 'div', { text: 'Waiting', role: 'connection', styles: { color: '#848E9C', fontSize: '11px' } });
  const spec = element(document, 'div', { text: `Local spec ${STRATEGY29_SPEC_VERSION}`, role: 'spec', styles: { color: '#848E9C', fontSize: '11px' } });
  const reference = element(document, 'div', { text: `Local reference ${STRATEGY29_REFERENCE_SHA256}`, role: 'reference', styles: { color: '#848E9C', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'text' } });
  const statusFreshness = element(document, 'div', { text: 'Status not received', role: 'status-freshness', styles: { color: '#848E9C', fontSize: '11px' } });
  const eventsFreshness = element(document, 'div', { text: 'Events not checked', role: 'events-freshness', styles: { color: '#848E9C', fontSize: '11px' } });
  overview.append(connection, spec, reference, statusFreshness, eventsFreshness);
  const unitsTitle = element(document, 'div', { text: 'Watched timeframes', styles: { padding: '7px 10px 4px', borderTop: '1px solid rgba(132,142,156,.18)', color: '#848E9C', fontWeight: '600' } });
  const units = element(document, 'div', { role: 'units', styles: { display: 'grid', gap: '3px', padding: '0 7px 8px' } });
  const delivery = element(document, 'div', { text: 'Global delivery — waiting', role: 'delivery', styles: { padding: '7px 10px', borderTop: '1px solid rgba(132,142,156,.18)', color: '#848E9C', fontSize: '11px' } });
  const eventsTitle = element(document, 'div', { text: 'Recent cross-timeframe signals', styles: { padding: '7px 10px 4px', borderTop: '1px solid rgba(132,142,156,.18)', color: '#848E9C', fontWeight: '600' } });
  const events = element(document, 'div', { role: 'events', styles: { display: 'grid', gap: '3px', padding: '0 7px 8px' } });
  body.append(overview, unitsTitle, units, delivery, eventsTitle, events);
  panel.append(header, body);
  document.body.appendChild(panel);

  const eventRecords = new Map();
  let destroyed = false;
  function assertLive() {
    if (destroyed) throw new Error('Strategy 29 summary panel is destroyed');
  }
  function renderEvents() {
    events.replaceChildren();
    const ordered = [...eventRecords.values()].sort((left, right) => right.detected_at_ms - left.detected_at_ms || right.sequence - left.sequence);
    for (const event of ordered) {
      const row = element(document, 'div', {
        role: 'remote-event',
        styles: { display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) 116px', gap: '6px', alignItems: 'center', padding: '5px 6px', borderRadius: '5px', background: 'rgba(132,142,156,.08)' },
      });
      row.dataset.eventId = event.event_id;
      row.appendChild(element(document, 'strong', { text: event.timeframe, styles: { color: '#F0B90B' } }));
      row.appendChild(element(document, 'span', {
        text: signalLabel(event),
        styles: { color: event.signal_side === 'long' ? '#0ECB81' : '#F6465D', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      }));
      row.appendChild(element(document, 'span', { text: `Close ${formatClock(event.bar_close_ms)}`, styles: { color: '#848E9C', fontSize: '10px', textAlign: 'right' } }));
      events.appendChild(row);
    }
    if (ordered.length === 0) events.appendChild(element(document, 'span', { text: 'No recent signals', styles: { color: '#848E9C', padding: '4px' } }));
  }

  collapse.addEventListener('click', () => {
    const collapsed = body.style.display !== 'none';
    body.style.display = collapsed ? 'none' : 'block';
    collapse.textContent = collapsed ? 'Expand' : 'Collapse';
  });
  renderEvents();

  return Object.freeze({
    setConnection(state, message) {
      assertLive();
      if (!(state in STATE_COLORS) || typeof message !== 'string') throw new Error('Strategy 29 panel connection state is invalid');
      connection.dataset.state = state;
      connection.style.color = STATE_COLORS[state];
      connection.textContent = message;
    },
    renderStatus(snapshot) {
      assertLive();
      const matched = snapshot.spec_version === STRATEGY29_SPEC_VERSION;
      spec.dataset.state = matched ? 'matched' : 'error';
      spec.style.color = matched ? '#0ECB81' : '#F6465D';
      spec.textContent = matched
        ? `Spec version matched · ${STRATEGY29_SPEC_VERSION}`
        : `Spec mismatch · local ${STRATEGY29_SPEC_VERSION} · server ${snapshot.spec_version}`;
      statusFreshness.textContent = `Status ${formatClock(snapshot.observed_at_ms)}`;
      units.replaceChildren();
      const matching = snapshot.units.filter(unit => unit.symbol === canonicalSymbol);
      for (const unit of matching) {
        const row = element(document, 'div', {
          role: 'unit',
          styles: { display: 'grid', gridTemplateColumns: '42px 64px minmax(0,1fr)', gap: '6px', padding: '4px 6px', borderRadius: '5px', background: 'rgba(132,142,156,.08)' },
        });
        row.appendChild(element(document, 'strong', { text: unit.timeframe, styles: { color: '#EAECEF' } }));
        row.appendChild(element(document, 'span', { text: unit.status, styles: { color: STATUS_COLORS[unit.status] } }));
        row.appendChild(element(document, 'span', { text: unit.reason, styles: { color: '#848E9C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }));
        units.appendChild(row);
      }
      if (matching.length === 0) units.appendChild(element(document, 'span', { text: 'Symbol is not watched by the server', styles: { color: '#F0B90B', padding: '4px' } }));
      const counts = snapshot.delivery_counts;
      delivery.textContent = `Global delivery · Pending ${counts.pending} · Sending ${counts.sending} · Sent ${counts.sent} · Unknown ${counts.unknown} · Expired ${counts.expired} · Failed ${counts.failed}`;
    },
    addEvents(incoming, observedAtMs = null) {
      assertLive();
      for (const event of incoming) eventRecords.set(event.event_id, event);
      const ordered = [...eventRecords.values()].sort((left, right) => right.detected_at_ms - left.detected_at_ms || right.sequence - left.sequence);
      while (ordered.length > maxEvents) eventRecords.delete(ordered.pop().event_id);
      if (observedAtMs !== null) eventsFreshness.textContent = `Events checked ${formatClock(observedAtMs)}`;
      renderEvents();
    },
    clearEvents() {
      assertLive();
      eventRecords.clear();
      renderEvents();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      eventRecords.clear();
      panel.remove();
    },
    get size() { return eventRecords.size; },
  });
}
