import { createAlignedShape, createTradingViewMarkerPlacement } from './tradingview-event-layer.js';

const ICON_SIZE_PX = 36;
const CANDLE_GAP_PX = 8;
const SLOT_STEP_PX = 64;
const ICONS = Object.freeze({ arrow_down: 0xf063, arrow_up: 0xf062 });

function drawingOptions(color) {
  return {
    lock: true, disableSave: true, disableSelection: true,
    disableUndo: true, showInObjectsTree: false,
    overrides: { color },
  };
}

/** Two native entities per candidate; ordinary/user entity IDs never enter here.
 *
 * Native icon arrows support an explicit size and a centered anchor, unlike
 * fixed-size arrow marks or font-dependent text glyphs. Slots belong to the
 * resolved candle/side, not the decision timestamp: no-trade seconds can share
 * a prior candle. Eviction frees a slot without repositioning any survivor.
 */
export function createTradingViewCompoundLayer(target, { maxCandidates, candleWaitMs = 3000 }) {
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 80) throw new Error('Compound chart capacity must be 1..80');
  const { chart } = target;
  const placement = createTradingViewMarkerPlacement(chart, { candleWaitMs });
  const records = new Map();
  let pending = null;

  function dispose(recordsToRemove) {
    const errors = [];
    for (const record of recordsToRemove) {
      // A thrown removal has an unknown outcome. Do not automatically retry it.
      for (const id of record.ids.splice(0)) {
        try {
          chart.removeEntity(id);
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (errors.length) throw new AggregateError(errors, `Compound chart cleanup failed: ${errors.map((error) => error.message).join('; ')}`);
  }

  function remove(id) {
    const removals = [];
    if (pending?.id === id) {
      pending.controller.abort();
      removals.push(pending);
    }
    const record = records.get(id);
    if (record) {
      records.delete(id);
      removals.push(record);
    }
    dispose(removals);
  }

  function clear() {
    if (pending) pending.controller.abort();
    const removals = [...records.values()];
    records.clear();
    if (pending) removals.push(pending);
    dispose(removals);
  }

  async function renderCandidate(id, annotation, decisionAtMs) {
    if (pending !== null) throw new Error('Compound chart rendering must be serial');
    if (records.has(id)) return true;
    if (records.size >= maxCandidates) throw new Error('Compound chart capacity exceeded before eviction');
    if (typeof id !== 'string' || id.length === 0 || !Number.isSafeInteger(decisionAtMs) || decisionAtMs < 1) throw new Error('Compound chart candidate identity/time is invalid');
    const icon = ICONS[annotation.markerShape];
    if (icon === undefined || !['候选高', '候选低'].includes(annotation.markerLabel)) throw new Error('Compound chart direction/label is invalid');
    const operation = { id, controller: new AbortController(), ids: [] };
    pending = operation;
    try {
      const base = await placement.wait(annotation, {
        signal: operation.controller.signal, gapPx: CANDLE_GAP_PX + ICON_SIZE_PX / 2,
      });
      if (!base || operation.controller.signal.aborted) return false;
      const group = `${base.time}/${annotation.markerShape}`;
      const occupied = new Set([...records.values()].filter((record) => record.group === group).map((record) => record.slot));
      let slot = 0;
      while (occupied.has(slot)) slot += 1;
      const sign = annotation.markerShape === 'arrow_up' ? 1 : -1;
      const point = placement.shift(base, sign * slot * SLOT_STEP_PX);
      const labelPoint = placement.shift(point, sign > 0 ? 18 : -40);
      const options = drawingOptions(annotation.markerColor);
      const drawings = [
        [point, { ...options, shape: 'icon', icon, overrides: { ...options.overrides, size: ICON_SIZE_PX } }],
        [labelPoint, { ...options, shape: 'text', text: annotation.markerLabel, overrides: { ...options.overrides, fontsize: 12, bold: true, fillBackground: false, drawBorder: false } }],
      ];
      for (const [drawingPoint, drawing] of drawings) {
        const entityId = await createAlignedShape(chart, drawingPoint, drawing);
        operation.ids.push(entityId);
        if (operation.controller.signal.aborted) {
          dispose([operation]);
          return false;
        }
        const properties = chart.getShapeById(entityId).getProperties();
        const matched = properties.color === annotation.markerColor && (drawing.shape === 'icon'
          ? properties.icon === icon && properties.size === ICON_SIZE_PX
          : properties.text === annotation.markerLabel && properties.fontsize === 12);
        if (!matched) throw new Error('Compound chart drawing properties did not match the requested icon/label');
      }
      records.set(id, { ids: operation.ids.splice(0), group, slot, decisionAtMs });
      return true;
    } catch (error) {
      try {
        dispose([operation]);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `${error.message}; ${cleanupError.message}`);
      }
      throw error;
    } finally {
      pending = null;
    }
  }

  return Object.freeze({ renderCandidate, remove, clear, get size() { return records.size; } });
}
