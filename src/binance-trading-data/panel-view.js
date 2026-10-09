import { formatFundingPercent } from './market-data.js';
import { createHistoryChart } from './sparkline.js';
import { DATA_PANEL_WIDTH } from '../shared/data-panel-layout.js';
import {
  formatFundingPeriod, formatHistoryCount, formatHistoryTime, formatVotes,
  tradingMetricText, tradingText,
} from './ui-copy.js';

const PANEL_ID = 'jh-binance-trading-data-panel';
const INITIAL_FUNDING_STATE = Object.freeze({
  current: null, intervalHours: null, receivedAt: null, cached: false, error: null,
  intervalCached: false, intervalError: null,
});

function styles() {
  const scope = `#${PANEL_ID}`;
  return `
    ${scope} {
      --td-bg: var(--color-PrimaryBg, light-dark(#ffffff, #1e2329));
      --td-head: var(--color-SecondaryBg, light-dark(#fafbfc, #242a32));
      --td-text: var(--color-TextPrimary, light-dark(#202630, #eaecef));
      --td-muted: var(--color-TextSecondary, light-dark(#626c7d, #a6b0bf));
      --td-border: var(--color-Line, light-dark(#e4e8ef, #353d48));
      --td-buy: var(--color-Buy, light-dark(#24865e, #65c59c));
      --td-sell: var(--color-Sell, light-dark(#db3a50, #ff7c8f));
      --td-chart: var(--color-PrimaryYellow, light-dark(#b68208, #f0b90b));
      --td-highlight: color-mix(in srgb, var(--td-chart) 7%, var(--td-bg));
      --td-focus: light-dark(#315fe8, #9bb7ff);
      color-scheme: light dark;
      box-sizing: border-box;
      background: var(--td-bg);
      color: var(--td-text);
      border: 1px solid var(--td-border);
      border-radius: 10px;
      box-shadow: 0 6px 24px #00000020;
      font: 400 13px/1.35 BinancePlex, system-ui, -apple-system, sans-serif;
      text-align: left;
      overflow: hidden;
    }
    ${scope} * { box-sizing: border-box; }
    ${scope} [hidden] { display: none !important; }
    ${scope} #${PANEL_ID}-header {
      display: flex; align-items: center; gap: 6px; min-height: 35px;
      padding: 5px 8px; flex: 0 0 auto; cursor: move; user-select: none;
      border-bottom: 1px solid var(--td-border); background: var(--td-head);
    }
    ${scope} .td-grip { color: var(--td-muted); font-size: 14px; flex: 0 0 auto; }
    ${scope} .td-title { margin: 0; font-size: 14px; font-weight: 600; white-space: nowrap; }
    ${scope} #${PANEL_ID}-symbol {
      min-width: 0; color: var(--td-muted); font-size: 12px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    ${scope} .td-actions { display: flex; gap: 3px; margin-left: auto; flex: 0 0 auto; }
    ${scope} button { font: inherit; cursor: pointer; border: 0; color: inherit; background: transparent; }
    ${scope} .td-actions button {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; padding: 2px; border-radius: 4px;
      color: var(--td-muted); font-size: 17px;
    }
    ${scope} button:hover { background: var(--td-highlight); }
    ${scope} button:focus-visible { outline: 2px solid var(--td-focus); outline-offset: 2px; }
    ${scope} #${PANEL_ID}-body { min-height: 0; overflow: auto; overscroll-behavior: contain; }
    ${scope} table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    ${scope} .td-name-col { width: 42%; }
    ${scope} .td-trend-col { width: 28%; }
    ${scope} .td-value-col { width: 30%; }
    ${scope} thead { position: sticky; top: 0; z-index: 1; background: var(--td-head); }
    ${scope} thead th { color: var(--td-muted); font-size: 11px; font-weight: 500; padding: 4px 6px; text-align: left; }
    ${scope} thead th:nth-child(2) { text-align: center; }
    ${scope} thead th:last-child { text-align: right; }
    ${scope} tbody th, ${scope} tbody td { padding: 4px 6px; vertical-align: middle; border-top: 1px solid var(--td-border); }
    ${scope} .td-name { color: var(--td-muted); text-align: left; font-weight: 400; overflow-wrap: anywhere; }
    ${scope} .td-trend { padding: 4px 2px; text-align: center; }
    ${scope} .td-value { text-align: right; font-variant-numeric: tabular-nums; }
    ${scope} .td-number { font-weight: 500; overflow-wrap: anywhere; }
    ${scope} .jh-td-flash { animation: jh-td-value-change 1s ease-out; }
    @keyframes jh-td-value-change { from { background: color-mix(in srgb, var(--td-chart) 25%, transparent); } to { background: transparent; } }
    ${scope} small { display: block; margin-top: 1px; font-size: 11px; font-weight: 400; color: var(--td-muted); }
    ${scope} .td-value small { line-height: 1.35; }
    ${scope} .td-spark-button { display: block; width: 100%; padding: 0; border-radius: 4px; color: var(--td-chart); touch-action: pan-y; }
    ${scope} .td-sparkline { display: block; width: 100%; height: 26px; overflow: visible; }
    ${scope} .td-spark-path { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
    ${scope} .td-spark-reference { stroke: var(--td-border); stroke-width: 1; }
    ${scope} .td-spark-guide { stroke: var(--td-muted); stroke-width: 1; pointer-events: none; }
    ${scope} .td-spark-point { fill: currentColor; }
    ${scope} .td-spark-hit { fill: transparent; pointer-events: all; }
    ${scope} .td-buy-bar { fill: var(--td-buy); }
    ${scope} .td-sell-bar { fill: var(--td-sell); }
    ${scope} .td-no-history { display: block; padding: 3px 0; color: var(--td-muted); font-size: 11px; }
    ${scope} .td-trend-caption, ${scope} .td-last-settled { font-size: 11px; }
    ${scope} .td-last-settled { display: block; margin-top: 2px; color: var(--td-text); font-variant-numeric: tabular-nums; }
    ${scope} .td-last-value { display: inline-block; white-space: nowrap; }
    ${scope} .td-legend { display: flex; justify-content: center; gap: 6px; margin-top: 1px; color: var(--td-muted); font-size: 11px; }
    ${scope} .td-legend span { display: inline-flex; align-items: center; gap: 3px; }
    ${scope} .td-legend i { display: inline-block; width: 5px; height: 7px; background: var(--td-buy); }
    ${scope} .td-legend span:last-child i { background: var(--td-sell); }
    ${scope} .td-signal-long { color: var(--td-buy); }
    ${scope} .td-signal-short { color: var(--td-sell); }
    ${scope} .td-signal-neutral { color: var(--td-text); }
    ${scope} .td-dot { display: inline-block; width: 7px; height: 7px; margin-left: 5px; border-radius: 50%; border: 1px solid currentColor; background: currentColor; }
    ${scope} .td-signal-neutral .td-dot { color: var(--td-muted); }
    ${scope} .td-cached .td-dot { background: transparent; }
    ${scope} .td-data-status { color: var(--td-muted); }
    ${scope} .td-funding-row { background: var(--td-highlight); }
    ${scope} .td-funding-row .td-name { color: var(--td-text); font-weight: 500; }
    ${scope} .td-funding-row .td-number { font-size: 14px; font-weight: 600; }
    ${scope} .td-current-label { color: var(--td-text); margin: 0 0 1px; }
    ${scope} .td-countdown { font-variant-numeric: tabular-nums; }
    ${scope} .td-history-detail td { padding: 6px 8px; background: var(--td-head); }
    ${scope} .td-history-inspection { display: flex; flex-wrap: wrap; gap: 5px 12px; font-size: 11px; color: var(--td-muted); user-select: text; }
    ${scope} .td-history-inspection strong { flex: 1 0 100%; color: var(--td-text); font-size: 12px; font-weight: 500; }
    ${scope} .td-history-value { color: var(--td-text); font-variant-numeric: tabular-nums; }
    ${scope} #${PANEL_ID}-composite { padding: 6px 8px; border-top: 1px solid var(--td-border); }
    ${scope} .td-composite-line { display: flex; justify-content: space-between; gap: 6px; font-weight: 600; list-style: none; cursor: pointer; }
    ${scope} .td-composite-line::-webkit-details-marker { display: none; }
    ${scope} .td-composite-line:focus-visible { outline: 2px solid var(--td-focus); outline-offset: 2px; }
    ${scope} .td-composite-info { margin-left: 4px; color: var(--td-muted); font-size: 11px; font-weight: 400; }
    ${scope} .td-bias { white-space: nowrap; }
    ${scope} .td-vote-track { display: flex; height: 3px; margin-top: 4px; border-radius: 3px; overflow: hidden; background: var(--td-border); }
    ${scope} .td-vote-track span:first-child { background: var(--td-buy); }
    ${scope} .td-vote-track span:last-child { background: var(--td-sell); margin-left: auto; }
    ${scope} .td-composite-votes { margin-top: 3px; }
    ${scope} .td-method-note { margin-top: 4px; line-height: 1.4; }
    ${scope} #${PANEL_ID}-footer { padding: 5px 8px; color: var(--td-muted); font-size: 11px; border-top: 1px solid var(--td-border); font-variant-numeric: tabular-nums; }
    ${scope} .td-footer-line { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 3px 8px; }
    @media (max-width: 540px) {
      ${scope} { font-size: 12px; }
      ${scope} thead th, ${scope} tbody th, ${scope} tbody td { padding: 4px; }
      ${scope} .td-trend { padding: 4px 2px; }
      ${scope} .td-funding-row .td-number { font-size: 13px; }
    }
  `;
}

/** Owns display nodes only; the parent owns route identity, data refreshes and clocks. */
export function createTradingDataView({ document, panel, locale, collapsed, onCollapse, onClose }) {
  const style = document.createElement('style');
  style.textContent = styles();
  panel.append(style);
  Object.assign(panel.style, {
    width: `${DATA_PANEL_WIDTH}px`, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 24px)',
    display: 'flex', flexDirection: 'column',
  });
  const node = (tag, className = '', text = '') => {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  const setText = (element, value) => {
    if (element.textContent !== value) element.textContent = value;
  };
  const identify = (element, suffix) => {
    element.id = `${PANEL_ID}-${suffix}`;
    return element;
  };
  const role = (element, value) => {
    element.dataset.role = value;
    return element;
  };

  const header = identify(node('header'), 'header');
  const grip = node('span', 'td-grip', '☰');
  grip.setAttribute('aria-hidden', 'true');
  const title = node('h2', 'td-title');
  const symbol = identify(node('span'), 'symbol');
  const actions = node('div', 'td-actions');
  const collapseButton = identify(node('button'), 'collapse');
  const closeButton = identify(node('button', '', '×'), 'close');
  collapseButton.type = closeButton.type = 'button';
  collapseButton.setAttribute('aria-controls', `${PANEL_ID}-body`);
  actions.append(collapseButton, closeButton);
  header.append(grip, title, symbol, actions);
  const body = identify(node('div'), 'body');
  const table = node('table');
  const columns = node('colgroup');
  for (const name of ['name', 'trend', 'value']) columns.append(node('col', `td-${name}-col`));
  const tableHead = node('thead');
  const headingRow = node('tr');
  const headings = ['metric', 'history', 'value'].map(key => {
    const heading = node('th');
    heading.scope = 'col';
    heading.dataset.copy = key;
    headingRow.append(heading);
    return heading;
  });
  tableHead.append(headingRow);
  const rows = identify(node('tbody'), 'rows');
  table.append(columns, tableHead, rows);
  const composite = identify(node('div'), 'composite');
  const footer = identify(node('footer'), 'footer');
  const footerLine = node('div', 'td-footer-line');
  footerLine.append(role(node('span'), 'updated-at'), role(node('span'), 'elapsed'));
  const historyNote = node('small', 'td-history-note');
  footer.append(footerLine, historyNote);
  body.append(table, composite, footer);
  panel.append(header, body);

  let currentModel = null;
  let currentFunding = INITIAL_FUNDING_STATE;
  let currentClock = null;
  let fundingNodes = null;
  let charts = [];
  let openDetail = null;

  function closeDetails() {
    if (openDetail !== null) {
      openDetail.row.remove();
      openDetail.button.setAttribute('aria-expanded', 'false');
      openDetail = null;
    }
  }

  function updateHeading() {
    const panelTitle = tradingText('title', locale);
    panel.lang = locale;
    panel.setAttribute('aria-label', panelTitle);
    table.setAttribute('aria-label', panelTitle);
    setText(title, panelTitle);
    setText(historyNote, tradingText('historyNote', locale));
    for (const heading of headings) setText(heading, tradingText(heading.dataset.copy, locale));
    const collapseTitle = tradingText(collapsed ? 'expand' : 'collapse', locale);
    collapseButton.title = collapseTitle;
    collapseButton.setAttribute('aria-label', collapseTitle);
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    setText(collapseButton, collapsed ? '□' : '−');
    closeButton.title = tradingText('close', locale);
    closeButton.setAttribute('aria-label', closeButton.title);
    body.style.display = collapsed ? 'none' : 'block';
  }

  function collapse() {
    collapsed = !collapsed;
    updateHeading();
    onCollapse(collapsed);
  }
  function close() { onClose(); }
  collapseButton.addEventListener('click', collapse);
  closeButton.addEventListener('click', close);

  function showStatus(element, key, error) {
    const text = key === null ? '' : tradingText(key, locale);
    setText(element, text);
    element.hidden = text === '';
    element.title = error ? `${text}: ${error}` : text;
  }

  function updateCountdown() {
    if (fundingNodes === null || !fundingNodes.number.isConnected) return;
    let value;
    if (currentClock === null || !currentClock.calibrated) {
      value = tradingText('clockUnavailable', locale);
    } else if (currentFunding.current === null) {
      value = '--';
    } else {
      const remaining = currentFunding.current.nextFundingTime - currentClock.now;
      if (remaining <= 0) {
        value = tradingText('waitingUpdate', locale);
      } else {
        const seconds = Math.ceil(remaining / 1_000);
        const hours = Math.floor(seconds / 3_600);
        const minutes = Math.floor(seconds % 3_600 / 60);
        value = [hours, minutes, seconds % 60].map(part => String(part).padStart(2, '0')).join(':');
      }
    }
    setText(fundingNodes.countdown, `${tradingText('countdown', locale)} ${value}`);
  }

  function updateFunding() {
    if (fundingNodes === null || !fundingNodes.number.isConnected) return;
    const state = currentFunding;
    const expired = state.current !== null && currentClock !== null && currentClock.calibrated
      && state.current.nextFundingTime <= currentClock.now;
    setText(fundingNodes.number, formatFundingPercent(state.current === null || expired ? null : state.current.value));
    setText(fundingNodes.period, formatFundingPeriod(state.intervalHours, locale));
    fundingNodes.number.title = tradingText('fundingNote', locale);
    if (state.current !== null) fundingNodes.number.title += `\n${formatHistoryTime(state.current.time, locale)}`;
    const status = expired && state.error === null ? 'waitingUpdate' : state.current === null
      ? state.error ? 'loadFailed' : 'loading'
      : state.cached ? state.error ? 'cachedFailure' : 'cached' : state.error ? 'refreshFailed' : null;
    const intervalStatus = state.intervalHours !== null && state.intervalCached
      ? state.intervalError ? 'intervalCachedFailure' : 'intervalCached'
      : state.intervalError ? 'intervalLoadFailed' : null;
    showStatus(fundingNodes.status, status, state.error);
    showStatus(fundingNodes.intervalStatus, intervalStatus, state.intervalError);
    updateCountdown();
  }

  function renderIndicator(indicator, previousValue) {
    const { id } = indicator;
    const isFunding = id === 'funding';
    const row = node('tr', isFunding ? 'td-funding-row' : '');
    row.dataset.metric = id;
    row.classList.toggle('td-cached', indicator.cached && indicator.value !== null);
    const name = node('th', 'td-name', tradingMetricText(id, 'name', locale));
    name.scope = 'row';
    name.title = tradingMetricText(id, 'detail', locale);
    const trend = node('td', 'td-trend');
    const detailRow = node('tr', 'td-history-detail');
    detailRow.id = `${PANEL_ID}-history-${id}`;
    const detailCell = node('td');
    detailCell.colSpan = 3;
    const inspection = node('div', 'td-history-inspection');
    inspection.setAttribute('role', 'status');
    inspection.setAttribute('aria-atomic', 'true');
    const detailTitle = node('strong');
    const detailTime = node('time');
    const detailValue = node('span', 'td-history-value');
    inspection.append(detailTitle, detailTime, detailValue);
    detailCell.append(inspection);
    detailRow.append(detailCell);
    const chart = createHistoryChart({
      document, indicator, locale,
      onInspect(record, action) {
        setText(detailTitle, `${record.name} · ${formatHistoryCount(id, chart.count, locale)}`);
        setText(detailTime, record.time);
        detailTime.dateTime = new Date(record.timestamp).toISOString();
        setText(detailValue, record.value);
        if (action === 'hover') return;
        const shouldClose = action === 'close' || (action === 'toggle' && openDetail?.row === detailRow);
        closeDetails();
        if (shouldClose) return;
        row.after(detailRow);
        chart.element.setAttribute('aria-expanded', 'true');
        openDetail = { row: detailRow, button: chart.element };
      },
    });
    charts.push(chart);
    if (chart.count > 0) chart.element.setAttribute('aria-controls', detailRow.id);
    trend.append(chart.element);
    if (isFunding) {
      trend.append(node('small', 'td-trend-caption', formatHistoryCount(id, chart.count, locale)));
      const settled = node('span', 'td-last-settled');
      settled.append(document.createTextNode(`${tradingText('last', locale)} `), node('span', 'td-last-value', indicator.display));
      trend.append(settled);
    }
    if (id === 'taker') {
      const legend = node('div', 'td-legend');
      for (const side of ['buy', 'sell']) {
        const item = node('span');
        const swatch = node('i');
        swatch.setAttribute('aria-hidden', 'true');
        item.append(swatch, document.createTextNode(tradingText(side, locale)));
        legend.append(item);
      }
      trend.append(legend);
    }

    const value = node('td', `td-value td-signal-${isFunding ? 'neutral' : indicator.signal}`);
    const number = node('span', 'td-number', isFunding ? '--' : indicator.display);
    if (!isFunding && previousValue !== undefined && previousValue !== null && indicator.value !== null && previousValue !== indicator.value) {
      number.classList.add('jh-td-flash');
    }
    if (isFunding) {
      const period = role(node('small', 'td-current-label'), 'funding-period');
      const countdown = role(node('small', 'td-countdown'), 'funding-countdown');
      const status = role(node('small', 'td-data-status'), 'funding-status');
      const intervalStatus = role(node('small', 'td-data-status'), 'funding-interval-status');
      role(number, 'current-funding');
      value.append(period, number, countdown, status, intervalStatus);
      fundingNodes = { number, period, countdown, status, intervalStatus };
    } else {
      const reading = node('div');
      const dot = node('span', 'td-dot');
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', tradingText(indicator.signal, locale));
      reading.append(number, dot);
      value.append(reading);
      const unit = id === 'taker' ? tradingText('buySellRatio', locale)
        : id === 'basis' ? tradingText('basisRate', locale) : indicator.unit;
      if (unit) value.append(node('small', 'td-unit', unit));
    }
    const dataStatus = node('small', 'td-data-status');
    const statusKey = indicator.value === null
      ? indicator.error ? 'loadFailed' : 'missing'
      : indicator.cached ? indicator.error ? 'cachedFailure' : 'cached' : null;
    showStatus(dataStatus, statusKey, indicator.error);
    (isFunding ? trend : value).append(dataStatus);
    row.append(name, trend, value);
    rows.append(row);
  }

  function renderComposite(model) {
    const signal = model.longCount === model.shortCount ? 'neutral' : model.longCount > model.shortCount ? 'long' : 'short';
    const method = node('details', 'td-method');
    method.open = composite.querySelector('.td-method')?.open === true;
    const line = node('summary', 'td-composite-line');
    const label = node('span', '', tradingText('composite', locale));
    const info = node('span', 'td-composite-info', 'ⓘ');
    info.setAttribute('aria-hidden', 'true');
    label.append(info);
    line.append(label, node('span', `td-bias td-signal-${signal}`, `${tradingText(signal, locale)} ${model.longCount}:${model.shortCount}`));
    method.append(line, node('small', 'td-method-note', tradingText('simplifiedNote', locale)));
    const track = node('div', 'td-vote-track');
    const votes = formatVotes(model, locale);
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', votes);
    for (const count of [model.longCount, model.shortCount]) {
      const bar = node('span');
      bar.style.width = `${model.total > 0 ? count / model.total * 100 : 0}%`;
      track.append(bar);
    }
    composite.replaceChildren(method, track, node('small', 'td-composite-votes', votes));
  }

  function render(model) {
    const previousValues = new Map(currentModel !== null && currentModel.symbol === model.symbol
      ? currentModel.indicators.map(indicator => [indicator.id, indicator.value]) : []);
    currentModel = model;
    // Binance can temporarily detach output slots during a host DOM update.
    if (![symbol, rows, composite, footer].every(element => element.isConnected)) return;
    setText(symbol, model.symbol);
    symbol.title = model.symbol;
    closeDetails();
    charts.forEach(chart => chart.destroy());
    charts = [];
    rows.replaceChildren();
    fundingNodes = null;
    for (const indicator of model.indicators) renderIndicator(indicator, previousValues.get(indicator.id));
    renderComposite(model);
    updateFunding();
  }

  updateHeading();
  return {
    render,
    setFunding(state, clock) {
      currentFunding = state;
      currentClock = clock;
      updateFunding();
    },
    updateClock(clock) {
      currentClock = clock;
      updateFunding();
    },
    setLocale(nextLocale) {
      if (locale === nextLocale) return;
      locale = nextLocale;
      updateHeading();
      if (currentModel !== null) render(currentModel);
    },
    destroy() {
      collapseButton.removeEventListener('click', collapse);
      closeButton.removeEventListener('click', close);
      charts.forEach(chart => chart.destroy());
      charts = [];
      closeDetails();
      style.remove();
    },
  };
}
