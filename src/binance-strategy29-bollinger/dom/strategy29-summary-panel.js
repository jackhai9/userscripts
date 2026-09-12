import { STRATEGY29_REFERENCE_SHA256, STRATEGY29_API_SPEC_VERSION } from '../core/remote-summary-contract.js';

import { SUMMARY_COPY as COPY, SELECTION_REASONS, STATUS_LABELS, SIGNAL_LABELS, processingReason, formatLocalizedText, resolveUiLocaleFromPathname } from '../ui-copy.js';
import { installPanelPosition } from './panel-position.js';

const PANEL_ID = 'jh-strategy29-summary-panel';

/** Backfilled intervals can be inserted later than more recent live signals. */
function newestSignalFirst(left, right) {
  return right.bar_close_ms - left.bar_close_ms || right.sequence - left.sequence;
}

const STATE_COLORS = Object.freeze({
  disabled: '#848E9C',
  module_disabled: '#848E9C',
  gateway_unavailable: '#F0B90B',
  connected: '#0ECB81',
  connecting: '#F0B90B',
  unavailable: '#F0B90B',
  disconnected: '#F6465D',
  stopped: '#F6465D',
  incompatible: '#F6465D',
  configuration_required: '#F0B90B',
});
const STATUS_COLORS = Object.freeze({
  ready: '#848E9C',
  warming: '#F0B90B',
  stale: '#F6465D',
  insufficient_history: '#F0B90B',
  data_gap: '#F6465D',
  failed: '#F6465D',
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

export function createStrategy29SummaryPanel(document, canonicalSymbol, { maxEvents = 20, locale = resolveUiLocaleFromPathname(document.location.pathname), loadPosition, savePosition } = {}) {
  if (!document?.body) throw new Error('Strategy 29 summary panel requires document.body');
  if (typeof canonicalSymbol !== 'string' || canonicalSymbol.length === 0) throw new Error('Strategy 29 panel symbol is invalid');
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 100) throw new Error('Strategy 29 panel maxEvents is invalid');
  const text = value => formatLocalizedText(value, locale);
  text(COPY.waiting);
  if (typeof loadPosition !== 'function' || typeof savePosition !== 'function') throw new TypeError('Strategy 29 panel position adapters are required');
  const stored = loadPosition();
  if (stored !== null && (!stored || typeof stored !== 'object' || !Number.isFinite(stored.left) || !Number.isFinite(stored.top))) throw new TypeError('Strategy 29 panel position is invalid');
  document.getElementById(PANEL_ID)?.remove();

  const panel = element(document, 'section', {
    styles: {
      position: 'fixed', zIndex: '999995', left: '0', top: '0', width: '340px',
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
  const heading = element(document, 'strong', { text: text(COPY.title), styles: { flex: '1', fontSize: '13px' } });
  header.appendChild(element(document, 'span', { text: '☰', styles: { color: '#848E9C' } }));
  header.appendChild(heading);
  header.title = text(COPY.drag);
  const collapse = element(document, 'button', {
    text: text(COPY.collapse), role: 'collapse',
    styles: { border: '0', borderRadius: '5px', padding: '2px 7px', background: 'rgba(132,142,156,.18)', color: '#EAECEF', cursor: 'pointer' },
  });
  collapse.type = 'button';
  header.appendChild(collapse);
  const body = element(document, 'div', { role: 'body', styles: { maxHeight: 'calc(100vh - 150px)', overflow: 'auto' } });
  const overview = element(document, 'div', { styles: { display: 'grid', gap: '4px', padding: '9px 10px' } });
  overview.appendChild(element(document, 'div', { text: canonicalSymbol, role: 'symbol', styles: { fontWeight: '700' } }));
  const connection = element(document, 'div', { text: text(COPY.waiting), role: 'connection', styles: { color: '#848E9C', fontSize: '11px' } });
  const spec = element(document, 'div', { text: text(COPY.observerSpec(STRATEGY29_API_SPEC_VERSION)), role: 'spec', styles: { color: '#848E9C', fontSize: '11px' } });
  const reference = element(document, 'div', { text: text(COPY.reference(STRATEGY29_REFERENCE_SHA256)), role: 'reference', styles: { color: '#848E9C', fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'text' } });
  const statusFreshness = element(document, 'div', { text: text(COPY.noStatus), role: 'status-freshness', styles: { color: '#848E9C', fontSize: '11px' } });
  const eventsFreshness = element(document, 'div', { text: text(COPY.noEventsCheck), role: 'events-freshness', styles: { color: '#848E9C', fontSize: '11px' } });
  const selection = element(document, 'div', { role: 'selection', styles: { color: '#EAECEF', fontSize: '11px' } });
  const selectionRefresh = element(document, 'div', { role: 'selection-refresh', styles: { color: '#848E9C', fontSize: '11px' } });
  overview.append(connection, spec, reference, statusFreshness, selection, selectionRefresh, eventsFreshness);
  const unitsTitle = element(document, 'div', { text: text(COPY.processing), styles: { padding: '7px 10px 4px', borderTop: '1px solid rgba(132,142,156,.18)', color: '#848E9C', fontWeight: '600' } });
  const processingHint = element(document, 'div', {
    text: text(COPY.processingHint),
    styles: { fontSize: '11px', fontWeight: '400' },
  });
  unitsTitle.appendChild(processingHint);
  const units = element(document, 'div', { role: 'units', styles: { display: 'grid', gap: '3px', padding: '0 7px 8px' } });
  const delivery = element(document, 'div', { text: text(COPY.waitingDelivery), role: 'delivery', styles: { padding: '7px 10px', borderTop: '1px solid rgba(132,142,156,.18)', color: '#848E9C', fontSize: '11px' } });
  const eventsTitle = element(document, 'div', { text: text(COPY.recent), styles: { padding: '7px 10px 4px', borderTop: '1px solid rgba(132,142,156,.18)', color: '#848E9C', fontWeight: '600' } });
  const events = element(document, 'div', { role: 'events', styles: { display: 'grid', gap: '3px', padding: '0 7px 8px' } });
  body.append(overview, unitsTitle, units, delivery, eventsTitle, events);
  panel.append(header, body);
  document.body.appendChild(panel);

  const position = installPanelPosition(document, panel, header, { initialPosition: stored, savePosition });
  const eventRecords = new Map();
  let lastStatus = null;
  function clearCurrentStatus() {
    lastStatus = null;
    spec.dataset.state = 'unavailable';
    spec.style.color = '#848E9C';
    spec.textContent = text(COPY.observerSpec(STRATEGY29_API_SPEC_VERSION));
    statusFreshness.textContent = text(COPY.noStatus);
    selection.dataset.state = 'unavailable';
    selection.style.color = '#848E9C';
    selection.textContent = text(COPY.noLiveStatus);
    selectionRefresh.textContent = '';
    units.replaceChildren();
    delivery.textContent = text(COPY.waitingDelivery);
  }
  let lastEventsAt = null;
  let connectionCopy = COPY.waiting;
  let destroyed = false;
  function assertLive() {
    if (destroyed) throw new Error('Strategy 29 summary panel is destroyed');
  }
  function renderEvents(ordered) {
    events.replaceChildren();
    for (const event of ordered) {
      const row = element(document, 'div', {
        role: 'remote-event',
        styles: { display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) 116px', gap: '6px', alignItems: 'center', padding: '5px 6px', borderRadius: '5px', background: 'rgba(132,142,156,.08)' },
      });
      row.dataset.eventId = event.event_id;
      row.appendChild(element(document, 'strong', { text: event.timeframe, styles: { color: '#F0B90B' } }));
      row.appendChild(element(document, 'span', {
        text: text(SIGNAL_LABELS[`${event.setup_direction}:${event.signal_type}`]),
        styles: { color: event.signal_side === 'long' ? '#0ECB81' : '#F6465D', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      }));
      row.appendChild(element(document, 'span', { text: text(COPY.close(formatClock(event.bar_close_ms))), styles: { color: '#848E9C', fontSize: '10px', textAlign: 'right' } }));
      events.appendChild(row);
    }
    if (ordered.length === 0) events.appendChild(element(document, 'span', { text: text(COPY.noEvents), styles: { color: '#848E9C', padding: '4px' } }));
  }

  collapse.addEventListener('click', () => {
    const collapsed = body.style.display !== 'none';
    body.style.display = collapsed ? 'none' : 'block';
    collapse.textContent = text(collapsed ? COPY.expand : COPY.collapse);
    position.clamp();
  });
  renderEvents([]);

  const api = Object.freeze({
    setLocale(nextLocale) {
      assertLive();
      formatLocalizedText(COPY.waiting, nextLocale);
      if (locale === nextLocale) return;
      locale = nextLocale;
      heading.textContent = text(COPY.title);
      header.title = text(COPY.drag);
      collapse.textContent = text(body.style.display === 'none' ? COPY.expand : COPY.collapse);
      connection.textContent = text(connectionCopy);
      reference.textContent = text(COPY.reference(STRATEGY29_REFERENCE_SHA256));
      unitsTitle.firstChild.textContent = text(COPY.processing);
      processingHint.textContent = text(COPY.processingHint);
      eventsTitle.textContent = text(COPY.recent);
      eventsFreshness.textContent = text(lastEventsAt === null ? COPY.noEventsCheck : COPY.eventsAt(formatClock(lastEventsAt)));
      if (lastStatus !== null) api.renderStatus(lastStatus);
      else clearCurrentStatus();
      renderEvents([...eventRecords.values()].sort(newestSignalFirst));
      position.clamp();
    },
    setConnection(state, message) {
      assertLive();
      if (!(state in STATE_COLORS)) throw new Error('Strategy 29 panel connection state is invalid');
      connection.dataset.state = state;
      connection.style.color = STATE_COLORS[state];
      connectionCopy = message;
      connection.textContent = text(message);
      if (['disabled', 'module_disabled', 'gateway_unavailable', 'unavailable'].includes(state)) clearCurrentStatus();
      position.clamp();
    },
    renderStatus(snapshot) {
      assertLive();
      lastStatus = snapshot;
      const matched = snapshot.spec_version === STRATEGY29_API_SPEC_VERSION;
      spec.dataset.state = matched ? 'matched' : 'error';
      spec.style.color = matched ? '#0ECB81' : '#F6465D';
      spec.textContent = matched
        ? text(COPY.matched(STRATEGY29_API_SPEC_VERSION))
        : text(COPY.mismatch(STRATEGY29_API_SPEC_VERSION, snapshot.spec_version));
      statusFreshness.textContent = text(COPY.statusAt(formatClock(snapshot.observed_at_ms)));
      if (!matched) {
        selection.dataset.state = 'incompatible';
        selection.style.color = '#F6465D';
        selection.textContent = text(COPY.incompatibleSelection);
        selectionRefresh.textContent = '';
        units.replaceChildren();
        delivery.textContent = text(COPY.incompatibleDelivery);
        position.clamp();
        return;
      }
      const universe = snapshot.universe;
      const unavailable = universe.refresh_status === 'fail_closed';
      selection.dataset.state = universe.refresh_status;
      selection.style.color = unavailable ? '#F6465D' : universe.refresh_status === 'fresh' ? '#0ECB81' : '#F0B90B';
      selection.textContent = [text(SELECTION_REASONS[universe.reason]), text(COPY.generation(universe.generation ?? text(COPY.pending))), text(COPY.markets(universe.selected_markets.length)), text(COPY.ready(universe.ready_unit_count, universe.selected_unit_count)), text(COPY.intervals(universe.configured_timeframes.join(', ') || text(COPY.pending)))].join(' · ');
      selectionRefresh.textContent = universe.last_successful_refreshed_at_ms === null
        ? text(COPY.noSuccess)
        : text(COPY.lastSuccess(formatClock(universe.last_successful_refreshed_at_ms), universe.last_success_age_seconds.toFixed(1)));
      units.replaceChildren();
      const selected = universe.selected_markets.includes(canonicalSymbol);
      const matching = unavailable || !selected ? [] : snapshot.units.filter(unit => (
        unit.symbol === canonicalSymbol && universe.configured_timeframes.includes(unit.timeframe)
      ));
      for (const unit of matching) {
        const row = element(document, 'div', {
          role: 'unit',
          styles: { display: 'grid', gridTemplateColumns: '36px 78px minmax(0,1fr)', gap: '6px', padding: '4px 6px', borderRadius: '5px', background: 'rgba(132,142,156,.08)' },
        });
        row.appendChild(element(document, 'strong', { text: unit.timeframe, styles: { color: '#EAECEF' } }));
        // Stored processing can succeed before the current live admission is ready.
        row.appendChild(element(document, 'span', { text: text(STATUS_LABELS[unit.status]), styles: { color: STATUS_COLORS[unit.status] } }));
        row.appendChild(element(document, 'span', { text: processingReason(unit.reason, locale), styles: { color: '#848E9C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }));
        units.appendChild(row);
      }
      if (matching.length === 0) units.appendChild(element(document, 'span', {
        text: text(unavailable ? COPY.unavailableSelection : selected ? COPY.awaitingUnits : COPY.notSelected),
        styles: { color: '#F0B90B', padding: '4px' },
      }));
      const counts = snapshot.delivery_counts;
      delivery.textContent = text(COPY.delivery(counts));
      position.clamp();
    },
    addEvents(incoming, observedAtMs = null) {
      assertLive();
      if (incoming.length > 0) {
        for (const event of incoming) eventRecords.set(event.event_id, event);
        const ordered = [...eventRecords.values()].sort(newestSignalFirst);
        while (ordered.length > maxEvents) eventRecords.delete(ordered.pop().event_id);
        renderEvents(ordered);
      }
      // Empty increments still advance freshness, but contain no changes to retained rows.
      if (observedAtMs !== null) {
        lastEventsAt = observedAtMs;
        eventsFreshness.textContent = text(COPY.eventsAt(formatClock(observedAtMs)));
      }
      position.clamp();
    },
    clearEvents() {
      assertLive();
      eventRecords.clear();
      renderEvents([]);
      position.clamp();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      eventRecords.clear();
      position.destroy();
      panel.remove();
    },
    get size() { return eventRecords.size; },
  });
  position.clamp();
  return api;
}
