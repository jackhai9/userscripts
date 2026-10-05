import { createStrategy27Translator } from '../core/ui-copy.js';
import { createChartMarkerOverlay } from '../../shared/chart-marker-overlay.js';
import { createTradingViewMarkerPlacement, pinMarkerChartContext } from './tradingview-event-layer.js';

const ICON_SIZE_PX = 36;
const CANDLE_GAP_PX = 8;
const SLOT_STEP_PX = 64;

/**
 * Each immutable candidate owns one SVG arrow and label. Slots belong to its
 * resolved candle/side; eviction frees a slot without moving surviving records.
 * Pixel gaps are converted to prices once, preserving the existing placement contract.
 */
export function createTradingViewCompoundLayer(target, {
  maxCandidates, candleWaitMs = 3000, locale = 'zh-CN', onRenderError,
}) {
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 80) throw new Error('Compound chart capacity must be 1..80');
  let t = createStrategy27Translator(locale);
  const markerLabel = shape => shape === 'arrow_down' ? t('候选高', 'High candidate') : t('候选低', 'Low candidate');
  const placement = createTradingViewMarkerPlacement(target.chart, { candleWaitMs });
  const isChartCurrent = pinMarkerChartContext(target.chart);
  const records = new Map();
  let pending = null;
  let suspended = false;
  const overlay = createChartMarkerOverlay(target, {
    maxMarkers: maxCandidates * 2,
    onRenderError(error) {
      suspend();
      if (onRenderError) onRenderError(error);
      else throw error;
    },
  });
  const markers = () => [...records.values()].flatMap(record => record.markers);

  async function reconcile() {
    if (!suspended) overlay.render(markers(), { isCurrent: isChartCurrent });
  }

  function remove(id) {
    if (pending?.id === id) pending.controller.abort();
    const record = records.get(id);
    if (!record) return;
    records.delete(id);
    overlay.remove(record.markers.map(marker => marker.id));
  }

  function clear() {
    pending?.controller.abort();
    records.clear();
    overlay.clear();
  }

  async function renderCandidate(id, annotation, decisionAtMs) {
    if (suspended) return false;
    if (records.has(id)) return overlay.render(markers(), { isCurrent: isChartCurrent });
    if (pending !== null) throw new Error('Compound chart rendering must be serial');
    if (records.size >= maxCandidates) throw new Error('Compound chart capacity exceeded before eviction');
    if (typeof id !== 'string' || id.length === 0 || !Number.isSafeInteger(decisionAtMs) || decisionAtMs < 1) throw new Error('Compound chart candidate identity/time is invalid');
    const labels = annotation.markerShape === 'arrow_down' ? ['候选高', 'High candidate'] : ['候选低', 'Low candidate'];
    if (!['arrow_down', 'arrow_up'].includes(annotation.markerShape) || !labels.includes(annotation.markerLabel)) throw new Error('Compound chart direction/label is invalid');
    const operation = { id, controller: new AbortController() };
    pending = operation;
    try {
      const base = await placement.wait(annotation, {
        signal: operation.controller.signal, gapPx: CANDLE_GAP_PX + ICON_SIZE_PX / 2,
      });
      if (!base || suspended || operation.controller.signal.aborted || !isChartCurrent()) return false;
      const group = `${base.time}/${annotation.markerShape}`;
      const occupied = new Set([...records.values()].filter(record => record.group === group).map(record => record.slot));
      let slot = 0;
      while (occupied.has(slot)) slot += 1;
      const sign = annotation.markerShape === 'arrow_up' ? 1 : -1;
      const point = placement.shift(base, sign * slot * SLOT_STEP_PX);
      const labelPoint = placement.shift(point, sign > 0 ? 18 : -40);
      const style = { color: annotation.markerColor, direction: sign > 0 ? 'bullish' : 'bearish' };
      const candidateMarkers = [
        { ...style, id: `candidate:${id}:icon`, ...point, shape: annotation.markerShape,
          size: ICON_SIZE_PX, anchor: 'center', type: 'compound-icon' },
        { ...style, id: `candidate:${id}:label`, ...labelPoint, shape: 'text',
          size: 12, anchor: 'top', type: 'compound-label', text: markerLabel(annotation.markerShape) },
      ];
      if (!overlay.render([...markers(), ...candidateMarkers], { isCurrent: isChartCurrent })) return false;
      records.set(id, { group, slot, decisionAtMs, markerShape: annotation.markerShape, markers: candidateMarkers });
      return true;
    } finally {
      if (pending === operation) pending = null;
    }
  }

  /** Language changes update owned labels without moving immutable anchors or slots. */
  function setLocale(nextLocale) {
    t = createStrategy27Translator(nextLocale);
    for (const record of records.values()) {
      const label = record.markers[1];
      label.text = markerLabel(record.markerShape);
      overlay.updateText(label.id, label.text);
    }
  }

  /** Freeze verified evidence while cancelling unfinished candle placement. */
  function suspend() {
    suspended = true;
    pending?.controller.abort();
  }

  return Object.freeze({ setLocale, renderCandidate, reconcile, remove, clear, suspend, get size() { return records.size; } });
}
