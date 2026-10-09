import { formatFundingPercent, formatMetricValue } from './market-data.js';
import { formatHistoryTime, tradingMetricText, tradingText } from './ui-copy.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 144;
const HEIGHT = 44;
const PADDING = 4;
const RATIO_METRICS = new Set(['top-accounts', 'top-positions', 'global-accounts']);

/** Responsive viewBox coordinates retain observed time gaps without resize listeners. */
export function createHistoryChart({ document, indicator, locale, onInspect }) {
  const { history, id, unit } = indicator;
  const volume = id === 'taker';
  const listeners = [];
  const listen = (node, type, listener) => {
    node.addEventListener(type, listener);
    listeners.push(() => node.removeEventListener(type, listener));
  };
  const destroy = () => listeners.splice(0).forEach(remove => remove());
  const svgElement = (tag, attributes) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };

  const points = history.map((point, index) => ({ ...point, index }));
  for (const point of points) {
    if (!Number.isFinite(point.timestamp) || (point.value !== null && !Number.isFinite(point.value))) {
      throw new Error(`Invalid historical observation for ${id}`);
    }
  }
  const available = point => volume
    ? Number.isFinite(point.buy) && Number.isFinite(point.sell)
    : point.value !== null;
  const observations = points.filter(available);
  if (observations.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'td-no-history';
    empty.textContent = tradingText('noHistory', locale);
    return { element: empty, count: 0, destroy };
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'td-spark-button';
  const name = tradingMetricText(id, 'name', locale);
  button.setAttribute('aria-label', `${name} · ${tradingText('inspect', locale)}`);
  button.setAttribute('aria-description', tradingText('keyboard', locale));
  button.setAttribute('aria-expanded', 'false');
  const svg = svgElement('svg', {
    class: 'td-sparkline', viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    preserveAspectRatio: 'none', 'aria-hidden': 'true',
  });
  const chartTitle = svgElement('title', {});
  chartTitle.textContent = `${name} · ${tradingText(id === 'funding' ? 'settledRecord' : 'historyRecord', locale)}`;
  svg.append(chartTitle);
  button.append(svg);

  const reference = RATIO_METRICS.has(id) ? 1 : (volume || id === 'funding' || id === 'basis') ? 0 : null;
  const values = observations.flatMap(point => volume ? [point.buy, point.sell] : [point.value]);
  if (reference !== null) values.push(reference);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const firstTime = Math.min(...points.map(point => point.timestamp));
  const lastTime = Math.max(...points.map(point => point.timestamp));
  const x = point => firstTime === lastTime
    ? WIDTH / 2
    : PADDING + (point.timestamp - firstTime) * (WIDTH - PADDING * 2) / (lastTime - firstTime);
  const y = value => maximum === minimum
    ? HEIGHT / 2
    : PADDING + (maximum - value) * (HEIGHT - PADDING * 2) / (maximum - minimum);
  const coordinate = value => Number(value.toFixed(3));

  if (reference !== null) {
    svg.append(svgElement('line', {
      x1: 0, x2: WIDTH, y1: y(reference), y2: y(reference), class: 'td-spark-reference',
    }));
  }

  if (volume) {
    for (let index = 0; index < observations.length; index += 1) {
      const point = observations[index];
      const previousGap = index === 0 ? WIDTH : x(point) - x(observations[index - 1]);
      const nextGap = index === observations.length - 1 ? WIDTH : x(observations[index + 1]) - x(point);
      const pairWidth = Math.min(12, previousGap * 0.8, nextGap * 0.8);
      const barWidth = pairWidth * 0.42;
      for (const [side, offset] of [['buy', -pairWidth / 2], ['sell', pairWidth * 0.08]]) {
        svg.append(svgElement('rect', {
          x: coordinate(x(point) + offset), y: coordinate(y(point[side])),
          width: coordinate(barWidth), height: coordinate(y(0) - y(point[side])),
          class: side === 'buy' ? 'td-buy-bar' : 'td-sell-bar',
        }));
      }
    }
  } else {
    /** Missing observations break the line; an isolated record is a point, never a synthetic segment. */
    const segments = [];
    let segment = [];
    for (const point of points) {
      if (point.value === null) {
        if (segment.length > 0) segments.push(segment);
        segment = [];
      } else {
        segment.push(point);
      }
    }
    if (segment.length > 0) segments.push(segment);
    for (const observed of segments) {
      if (observed.length > 1) {
        const path = observed.map((point, index) => `${index === 0 ? 'M' : 'L'}${coordinate(x(point))},${coordinate(y(point.value))}`).join(' ');
        svg.append(svgElement('path', { d: path, class: 'td-spark-path' }));
      }
      const last = observed[observed.length - 1];
      svg.append(svgElement('circle', {
        cx: coordinate(x(last)), cy: coordinate(y(last.value)), r: 2, class: 'td-spark-point',
      }));
    }
  }

  const guide = svgElement('line', { y1: 1, y2: HEIGHT - 1, class: 'td-spark-guide', opacity: 0 });
  svg.append(guide);
  let selected = observations.length - 1;

  function record(point) {
    const label = tradingText(id === 'funding' ? 'settledRecord' : 'historyRecord', locale);
    const quantity = value => `${formatMetricValue('oi', value, locale)}${unit ? ` ${unit}` : ''}`;
    const value = volume
      ? `${tradingText('buy', locale)} ${quantity(point.buy)} · ${tradingText('sell', locale)} ${quantity(point.sell)} · ${tradingText('buySellRatio', locale)} ${formatMetricValue('taker', point.value, locale)}`
      : `${id === 'funding' ? formatFundingPercent(point.value) : formatMetricValue(id, point.value, locale)}${id === 'oi' && unit ? ` ${unit}` : ''}`;
    return {
      name, label, value, timestamp: point.timestamp,
      time: formatHistoryTime(point.timestamp, locale),
    };
  }

  function select(index, action) {
    selected = index;
    const point = observations[index];
    const item = record(point);
    button.title = `${name} · ${item.label}\n${item.time}\n${item.value}`;
    button.setAttribute('aria-label', `${name} · ${tradingText('inspect', locale)} · ${item.time} · ${item.value}`);
    guide.setAttribute('x1', String(x(point)));
    guide.setAttribute('x2', String(x(point)));
    guide.setAttribute('opacity', action === 'initial' ? '0' : '0.65');
    if (action !== 'initial') onInspect(item, action);
  }

  for (let index = 0; index < observations.length; index += 1) {
    const point = observations[index];
    const left = index === 0 ? 0 : (x(observations[index - 1]) + x(point)) / 2;
    const right = index === observations.length - 1 ? WIDTH : (x(point) + x(observations[index + 1])) / 2;
    const hit = svgElement('rect', {
      x: coordinate(left), y: 0, width: coordinate(right - left), height: HEIGHT,
      class: 'td-spark-hit', 'data-history-index': index, 'data-timestamp': point.timestamp,
    });
    const title = svgElement('title', {});
    const item = record(point);
    title.textContent = `${item.time}\n${item.value}`;
    hit.append(title);
    listen(hit, 'pointerenter', () => select(index, 'hover'));
    listen(hit, 'pointerdown', () => select(index, 'hover'));
    svg.append(hit);
  }
  listen(button, 'click', event => {
    const hit = event.target.closest('[data-history-index]');
    select(hit ? Number(hit.dataset.historyIndex) : selected, 'toggle');
  });
  listen(button, 'keydown', event => {
    const movement = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in movement) {
      event.preventDefault();
      select(Math.max(0, Math.min(observations.length - 1, selected + movement[event.key])), 'open');
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      select(event.key === 'Home' ? 0 : observations.length - 1, 'open');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onInspect(record(observations[selected]), 'close');
    }
  });
  listen(button, 'pointerleave', () => {
    if (button.getAttribute('aria-expanded') === 'false') guide.setAttribute('opacity', '0');
  });
  select(selected, 'initial');
  return { element: button, count: observations.length, destroy };
}
