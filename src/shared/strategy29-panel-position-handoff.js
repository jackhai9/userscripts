const HANDOFF = Symbol.for('jh-userscripts.strategy29-panel-position-handoff');
const POSITION_KEY = 'strategy29SummaryPanelPosition';
const VERSION_KEY = 'strategy29PanelPositionHandoffVersion';

function copyPosition(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'left,top'
    || !Number.isFinite(value.left) || !Number.isFinite(value.top)) {
    throw new TypeError('Previous Strategy 29 panel position is invalid');
  }
  return Object.freeze({ left: value.left, top: value.top });
}

/** Preserve the final position saved while release 0.5.1 hosted the summary in Strategy27. */
export function publishStrategy29PanelPosition(view, getValue) {
  let record;
  try {
    record = { version: 1, position: copyPosition(getValue(POSITION_KEY, null)) };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    /** A corrupt nonsecret preference must not prevent Strategy27's transport from starting. */
    record = { version: 1, error: 'invalid_position' };
  }
  Object.defineProperty(view, HANDOFF, { value: Object.freeze(record) });
}

/** Consume once into Strategy29 storage; subsequent drags and reloads use only its own position. */
export function createStrategy29PositionReader(view, getValue, setValue) {
  return (key, initial) => {
    if (key !== POSITION_KEY) throw new TypeError('Strategy29 position reader received an unexpected key');
    const version = getValue(VERSION_KEY, null);
    if (version !== null && version !== 1) throw new TypeError('Strategy29 position handoff version is invalid');
    if (version === null) {
      const record = view[HANDOFF];
      if (!record || record.version !== 1 || Object.keys(record).sort().join(',') !== 'position,version') {
        throw new TypeError('Previous Strategy 29 panel position handoff is invalid');
      }
      const position = copyPosition(record.position);
      if (position !== null) setValue(POSITION_KEY, { ...position });
      setValue(VERSION_KEY, 1);
    }
    return getValue(key, initial);
  };
}
