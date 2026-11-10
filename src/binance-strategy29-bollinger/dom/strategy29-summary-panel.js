import { STRATEGY29_REFERENCE_SHA256, STRATEGY29_API_SPEC_VERSION, STRATEGY29_RECENT_EVENTS_PER_TIMEFRAME, compareStrategy29Timeframes } from '../core/remote-summary-contract.js';

import { SUMMARY_COPY as COPY, SELECTION_REASONS, STATUS_LABELS, SIGNAL_LABELS, processingReason, formatLocalizedText, resolveUiLocaleFromPathname } from '../ui-copy.js';
import { installPanelPosition } from '../../shared/panel-position.js';
import { setElementText } from '../../shared/dom-text.js';

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

export function createStrategy29SummaryPanel(document, canonicalSymbol, {
  locale = resolveUiLocaleFromPathname(document.location.pathname),
  loadPosition, savePosition, loadCollapsed, saveCollapsed,
} = {}) {
  if (!document?.body) throw new Error('Strategy 29 summary panel requires document.body');
  if (typeof canonicalSymbol !== 'string' || canonicalSymbol.length === 0) throw new Error('Strategy 29 panel symbol is invalid');
  const text = value => formatLocalizedText(value, locale);
  text(COPY.waiting);
  if (typeof loadPosition !== 'function' || typeof savePosition !== 'function') throw new TypeError('Strategy 29 panel position adapters are required');
  if (typeof loadCollapsed !== 'function' || typeof saveCollapsed !== 'function') throw new TypeError('Strategy 29 panel collapsed adapters are required');
  let collapsed = loadCollapsed();
  if (typeof collapsed !== 'boolean') throw new TypeError('Strategy 29 panel collapsed preference is invalid');
  const stored = loadPosition();
  if (stored !== null && (!stored || typeof stored !== 'object' || !Number.isFinite(stored.left) || !Number.isFinite(stored.top))) throw new TypeError('Strategy 29 panel position is invalid');
  const view = document.defaultView;
  if (!view) throw new Error('Strategy 29 panel window is unavailable');
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
  const timeframeSummary = element(document, 'div', { role: 'timeframes', styles: { color: '#848E9C', fontSize: '11px' } });
  const notices = element(document, 'div', { role: 'notices', styles: { color: '#F0B90B', fontSize: '11px', whiteSpace: 'pre-line' } });
  notices.setAttribute('aria-live', 'polite');
  const selectionDetails = element(document, 'div', { role: 'selection-details', styles: { color: '#848E9C', fontSize: '11px' } });
  const selectionRefresh = element(document, 'div', { role: 'selection-refresh', styles: { color: '#848E9C', fontSize: '11px' } });
  overview.append(connection, selection, timeframeSummary, eventsFreshness, notices);
  const unitsTitle = element(document, 'div', { text: text(COPY.processing), styles: { padding: '7px 10px 4px', borderTop: '1px solid rgba(132,142,156,.18)', color: '#848E9C', fontWeight: '600' } });
  const processingHint = element(document, 'div', {
    text: text(COPY.processingHint),
    styles: { fontSize: '11px', fontWeight: '400' },
  });
  unitsTitle.appendChild(processingHint);
  const units = element(document, 'div', { role: 'units', styles: { display: 'grid', gap: '3px', padding: '0 7px 8px' } });
  const delivery = element(document, 'div', { text: text(COPY.waitingDelivery), role: 'delivery', styles: { padding: '7px 10px', borderTop: '1px solid rgba(132,142,156,.18)', color: '#848E9C', fontSize: '11px' } });
  const eventsTitle = element(document, 'div', { text: text(COPY.recent), styles: { padding: '7px 10px 4px', borderTop: '1px solid rgba(132,142,156,.18)', color: '#848E9C', fontWeight: '600' } });
  const eventsHint = element(document, 'div', { text: text(COPY.perTimeframe(STRATEGY29_RECENT_EVENTS_PER_TIMEFRAME)), styles: { padding: '0 10px 5px', color: '#848E9C', fontSize: '11px' } });
  const events = element(document, 'div', { role: 'events', styles: { display: 'grid', gap: '3px', padding: '0 7px 8px' } });
  const missingSignals = element(document, 'div', { role: 'missing-signals', styles: { padding: '0 10px 8px', color: '#848E9C', fontSize: '11px' } });
  const diagnostics = element(document, 'details', { role: 'diagnostics', styles: { borderTop: '1px solid rgba(132,142,156,.18)' } });
  const diagnosticsTitle = element(document, 'summary', { text: text(COPY.diagnostics), styles: { padding: '8px 10px', color: '#848E9C', cursor: 'pointer' } });
  const diagnosticOverview = element(document, 'div', { styles: { display: 'grid', gap: '4px', padding: '0 10px 8px' } });
  diagnosticOverview.append(spec, reference, statusFreshness, selectionDetails, selectionRefresh);
  diagnostics.append(diagnosticsTitle, diagnosticOverview, unitsTitle, units, delivery);
  body.append(overview, eventsTitle, eventsHint, events, missingSignals, diagnostics);
  function renderCollapsed() {
    body.style.display = collapsed ? 'none' : 'block';
    setElementText(collapse, text(collapsed ? COPY.expand : COPY.collapse));
    collapse.setAttribute('aria-expanded', String(!collapsed));
  }
  /** The saved position must be clamped against the restored height on its first layout. */
  renderCollapsed();
  panel.append(header, body);
  document.body.appendChild(panel);

  const eventRecords = new Map();
  let configuredTimeframes = null;
  let statusMessages = [];
  let connectionState = null;
  let statusUnreliable = true;
  let lastStatus = null;
  function clearCurrentStatus() {
    lastStatus = null;
    spec.dataset.state = 'unavailable';
    spec.style.color = '#848E9C';
    setElementText(spec, text(COPY.observerSpec(STRATEGY29_API_SPEC_VERSION)));
    setElementText(statusFreshness, text(COPY.noStatus));
    selection.dataset.state = 'unavailable';
    selection.style.color = '#848E9C';
    setElementText(selection, text(COPY.noLiveStatus));
    setElementText(selectionDetails, '');
    setElementText(selectionRefresh, '');
    statusMessages = [];
    statusUnreliable = true;
    replaceList(units, NO_UNITS, () => []);
    setElementText(delivery, text(COPY.waitingDelivery));
    renderNotices();
  }
  let lastEventsAt = null;
  let connectionCopy = COPY.waiting;
  let destroyed = false;
  function assertLive() {
    if (destroyed) throw new Error('Strategy 29 summary panel is destroyed');
  }
  /** Rendered list content per container; an identical rebuild would still replace every child. */
  const renderedLists = new WeakMap();
  function replaceList(container, content, build) {
    const key = JSON.stringify(content);
    if (renderedLists.get(container) === key) return;
    container.replaceChildren(...build());
    renderedLists.set(container, key);
  }
  const NO_UNITS = Object.freeze({ rows: [], placeholder: null });
  function renderNotices() {
    const messages = [...statusMessages];
    if (eventRecords.size > 0 && (statusUnreliable || ['disabled', 'module_disabled', 'gateway_unavailable', 'unavailable', 'disconnected', 'stopped', 'incompatible'].includes(connectionState))) {
      messages.unshift(text(COPY.historicalOnly));
    }
    const message = messages.join('\n');
    setElementText(notices, message);
    notices.hidden = messages.length === 0;
  }
  function renderMissingSignals() {
    const present = new Set([...eventRecords.values()].map(event => event.timeframe));
    const missing = lastEventsAt === null || configuredTimeframes === null ? [] : configuredTimeframes.filter(timeframe => !present.has(timeframe));
    const message = missing.length === 0 ? '' : text(COPY.missingSignals(missing.join(', ')));
    setElementText(missingSignals, message);
    missingSignals.hidden = missing.length === 0;
  }
  function renderEvents(ordered) {
    const rows = ordered.map(event => ({
      id: event.event_id, timeframe: event.timeframe,
      label: text(SIGNAL_LABELS[`${event.setup_direction}:${event.signal_type}`]),
      color: event.signal_side === 'long' ? '#0ECB81' : '#F6465D',
      close: text(COPY.close(formatClock(event.bar_close_ms))),
    }));
    const placeholder = rows.length === 0 ? text(lastEventsAt === null ? COPY.waitingSignals : COPY.noEvents) : null;
    replaceList(events, { rows, placeholder }, () => {
      const nodes = rows.map(item => {
        const row = element(document, 'div', {
          role: 'remote-event',
          styles: { display: 'grid', gridTemplateColumns: '36px minmax(0,1fr) 116px', gap: '6px', alignItems: 'center', padding: '5px 6px', borderRadius: '5px', background: 'rgba(132,142,156,.08)' },
        });
        row.dataset.eventId = item.id;
        row.appendChild(element(document, 'strong', { text: item.timeframe, styles: { color: '#F0B90B' } }));
        row.appendChild(element(document, 'span', {
          text: item.label,
          styles: { color: item.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        }));
        row.appendChild(element(document, 'span', { text: item.close, styles: { color: '#848E9C', fontSize: '10px', textAlign: 'right' } }));
        return row;
      });
      if (placeholder !== null) nodes.push(element(document, 'span', { text: placeholder, styles: { color: '#848E9C', padding: '4px' } }));
      return nodes;
    });
    renderMissingSignals();
    renderNotices();
  }

  function onCollapse() {
    collapsed = !collapsed;
    renderCollapsed();
    saveCollapsed(collapsed);
  }
  collapse.addEventListener('click', onCollapse);
  renderEvents([]);

  const initialPosition = stored === null
    ? { left: view.innerWidth - panel.getBoundingClientRect().width - 84, top: 68 }
    : stored;
  const position = installPanelPosition(document, panel, header, { initialPosition, savePosition });
  /** Polling can change text without changing size; let native layout deliver only border-box changes. */
  const resizeObserver = new view.ResizeObserver(() => {
    if (!destroyed) position.clamp();
  });
  resizeObserver.observe(panel, { box: 'border-box' });

  const api = Object.freeze({
    setLocale(nextLocale) {
      assertLive();
      formatLocalizedText(COPY.waiting, nextLocale);
      if (locale === nextLocale) return;
      locale = nextLocale;
      setElementText(heading, text(COPY.title));
      header.title = text(COPY.drag);
      renderCollapsed();
      setElementText(connection, text(connectionCopy));
      setElementText(reference, text(COPY.reference(STRATEGY29_REFERENCE_SHA256)));
      setElementText(diagnosticsTitle, text(COPY.diagnostics));
      unitsTitle.firstChild.textContent = text(COPY.processing);
      setElementText(processingHint, text(COPY.processingHint));
      setElementText(eventsTitle, text(COPY.recent));
      setElementText(eventsHint, text(COPY.perTimeframe(STRATEGY29_RECENT_EVENTS_PER_TIMEFRAME)));
      setElementText(timeframeSummary, configuredTimeframes === null ? '' : text(COPY.intervals(configuredTimeframes.join(', '))));
      setElementText(eventsFreshness, text(lastEventsAt === null ? COPY.noEventsCheck : COPY.eventsAt(formatClock(lastEventsAt))));
      if (lastStatus !== null) api.renderStatus(lastStatus);
      else clearCurrentStatus();
      renderEvents([...eventRecords.values()].sort(newestSignalFirst));
    },
    setConnection(state, message) {
      assertLive();
      if (!(state in STATE_COLORS)) throw new Error('Strategy 29 panel connection state is invalid');
      connectionState = state;
      connection.dataset.state = state;
      connection.style.color = STATE_COLORS[state];
      connectionCopy = message;
      setElementText(connection, text(message));
      if (['disabled', 'module_disabled', 'gateway_unavailable', 'unavailable'].includes(state)) clearCurrentStatus();
      renderNotices();
    },
    renderStatus(snapshot) {
      assertLive();
      lastStatus = snapshot;
      const matched = snapshot.spec_version === STRATEGY29_API_SPEC_VERSION;
      spec.dataset.state = matched ? 'matched' : 'error';
      spec.style.color = matched ? '#0ECB81' : '#F6465D';
      setElementText(spec, matched
        ? text(COPY.matched(STRATEGY29_API_SPEC_VERSION))
        : text(COPY.mismatch(STRATEGY29_API_SPEC_VERSION, snapshot.spec_version)));
      setElementText(statusFreshness, text(COPY.statusAt(formatClock(snapshot.observed_at_ms))));
      if (!matched) {
        statusUnreliable = true;
        statusMessages = [text(COPY.updateRequired)];
        selection.dataset.state = 'incompatible';
        selection.style.color = '#F6465D';
        setElementText(selection, text(COPY.incompatibleSelection));
        setElementText(selectionDetails, '');
        setElementText(selectionRefresh, '');
        replaceList(units, NO_UNITS, () => []);
        setElementText(delivery, text(COPY.incompatibleDelivery));
        renderNotices();
        return;
      }
      const universe = snapshot.universe;
      const unavailable = universe.refresh_status === 'fail_closed';
      const selected = universe.selected_markets.includes(canonicalSymbol);
      statusUnreliable = unavailable || !selected;
      statusMessages = [];
      // Missing selection facts do not retire the last known configuration or its history.
      if (universe.configured_timeframes.length > 0) {
        const next = [...universe.configured_timeframes].sort(compareStrategy29Timeframes);
        if (configuredTimeframes === null || next.join(',') !== configuredTimeframes.join(',')) {
          configuredTimeframes = next;
          let removed = false;
          for (const [id, event] of eventRecords) {
            if (!next.includes(event.timeframe)) { eventRecords.delete(id); removed = true; }
          }
          if (removed) renderEvents([...eventRecords.values()].sort(newestSignalFirst));
        }
      }
      setElementText(timeframeSummary, configuredTimeframes === null ? '' : text(COPY.intervals(configuredTimeframes.join(', '))));
      selection.dataset.state = universe.refresh_status;
      selection.style.color = unavailable ? '#F6465D' : universe.refresh_status === 'fresh' ? '#0ECB81' : '#F0B90B';
      setElementText(selection, text(unavailable ? SELECTION_REASONS[universe.reason] : selected ? COPY.selected : COPY.notSelected));
      setElementText(selectionDetails, [text(SELECTION_REASONS[universe.reason]), text(COPY.generation(universe.generation ?? text(COPY.pending))), text(COPY.markets(universe.selected_markets.length)), text(COPY.ready(universe.ready_unit_count, universe.selected_unit_count))].join(' · '));
      setElementText(selectionRefresh, universe.last_successful_refreshed_at_ms === null
        ? text(COPY.noSuccess)
        : text(COPY.lastSuccess(formatClock(universe.last_successful_refreshed_at_ms), universe.last_success_age_seconds.toFixed(1))));
      const matching = unavailable || !selected ? [] : snapshot.units.filter(unit => (
        unit.symbol === canonicalSymbol && universe.configured_timeframes.includes(unit.timeframe)
      )).sort((left, right) => compareStrategy29Timeframes(left.timeframe, right.timeframe));
      if (!unavailable && universe.refresh_status !== 'fresh') statusMessages.push(text(SELECTION_REASONS[universe.reason]));
      if (!unavailable && universe.pending_unit_count > 0) statusMessages.push(text(COPY.globalPending(universe.pending_unit_count)));
      for (const unit of matching) {
        if (unit.status !== 'ready') statusMessages.push(`${unit.timeframe} · ${text(STATUS_LABELS[unit.status])}`);
      }
      // Stored processing can succeed before the current live admission is ready.
      const unitRows = matching.map(unit => ({
        timeframe: unit.timeframe, label: text(STATUS_LABELS[unit.status]), color: STATUS_COLORS[unit.status],
        reason: processingReason(unit.reason, locale),
      }));
      const unitPlaceholder = unitRows.length === 0
        ? text(unavailable ? COPY.unavailableSelection : selected ? COPY.awaitingUnits : COPY.notSelected)
        : null;
      replaceList(units, { rows: unitRows, placeholder: unitPlaceholder }, () => {
        const nodes = unitRows.map(item => {
          const row = element(document, 'div', {
            role: 'unit',
            styles: { display: 'grid', gridTemplateColumns: '36px 78px minmax(0,1fr)', gap: '6px', padding: '4px 6px', borderRadius: '5px', background: 'rgba(132,142,156,.08)' },
          });
          row.appendChild(element(document, 'strong', { text: item.timeframe, styles: { color: '#EAECEF' } }));
          row.appendChild(element(document, 'span', { text: item.label, styles: { color: item.color } }));
          row.appendChild(element(document, 'span', { text: item.reason, styles: { color: '#848E9C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }));
          return row;
        });
        if (unitPlaceholder !== null) nodes.push(element(document, 'span', { text: unitPlaceholder, styles: { color: '#F0B90B', padding: '4px' } }));
        return nodes;
      });
      if (!unavailable && selected && matching.length === 0) statusMessages.push(text(COPY.awaitingUnits));
      const counts = snapshot.delivery_counts;
      setElementText(delivery, text(COPY.delivery(counts)));
      renderMissingSignals();
      renderNotices();
    },
    addEvents(incoming, observedAtMs = null) {
      assertLive();
      const firstCheck = lastEventsAt === null && observedAtMs !== null;
      if (observedAtMs !== null) lastEventsAt = observedAtMs;
      if (incoming.length > 0) {
        for (const event of incoming) {
          if (configuredTimeframes === null || configuredTimeframes.includes(event.timeframe)) eventRecords.set(event.event_id, event);
        }
        const ordered = [...eventRecords.values()].sort(newestSignalFirst);
        const counts = new Map();
        const retained = ordered.filter(event => {
          const count = (counts.get(event.timeframe) ?? 0) + 1;
          counts.set(event.timeframe, count);
          if (count <= STRATEGY29_RECENT_EVENTS_PER_TIMEFRAME) return true;
          eventRecords.delete(event.event_id);
          return false;
        });
        renderEvents(retained);
      } else if (firstCheck && eventRecords.size === 0) {
        renderEvents([]);
      }
      // Empty increments still advance freshness, but contain no changes to retained rows.
      if (observedAtMs !== null) {
        setElementText(eventsFreshness, text(COPY.eventsAt(formatClock(observedAtMs))));
      }
      renderMissingSignals();
    },
    clearEvents() {
      assertLive();
      eventRecords.clear();
      lastEventsAt = null;
      setElementText(eventsFreshness, text(COPY.noEventsCheck));
      renderEvents([]);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      eventRecords.clear();
      collapse.removeEventListener('click', onCollapse);
      position.destroy();
      panel.remove();
    },
    get size() { return eventRecords.size; },
  });
  return api;
}
