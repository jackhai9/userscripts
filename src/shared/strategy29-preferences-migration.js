const RECORD = Symbol.for('jh-userscripts.strategy29-preferences-migration');
export const STRATEGY29_PREFERENCES_EVENT = 'jh-strategy29-preferences-ready';
export const SIGNAL_HOST_READY = Symbol.for('jh-userscripts.strategy29-signal-host-ready');
export const SIGNAL_HOST_READY_EVENT = 'jh-strategy29-signal-host-ready';
const COMPLETE = 'strategy29UnifiedPreferencesMigrated';
const ENABLED = 'strategy29RemoteSummaryEnabled';
const POSITION = 'strategy29SummaryPanelPosition';

function validate(record) {
  if (!record || Object.keys(record).sort().join(',') !== 'enabled,position,version' || record.version !== 1 || typeof record.enabled !== 'boolean') {
    throw new TypeError('Strategy29 preference migration record is invalid');
  }
  const point = record.position;
  if (point !== null && (Object.keys(point).sort().join(',') !== 'left,top' || !Number.isFinite(point.left) || !Number.isFinite(point.top))) {
    throw new TypeError('Strategy29 preference migration position is invalid');
  }
  return { version: 1, enabled: record.enabled, position: point === null ? null : { left: point.left, top: point.top } };
}

/** This public bridge carries cosmetic/module preferences only, never authentication or event data. */
export function publishStrategy29Preferences(view, getValue) {
  if (view[RECORD] !== undefined) {
    validate(view[RECORD]);
    return;
  }
  const record = validate({ version: 1, enabled: getValue(ENABLED, false), position: getValue(POSITION, null) });
  if (record.position !== null) Object.freeze(record.position);
  Object.defineProperty(view, RECORD, { value: Object.freeze(record) });
  view.dispatchEvent(new view.Event(STRATEGY29_PREFERENCES_EVENT));
}

/** Private destination values win; untrusted page preferences cannot supply a gateway or secret. */
export function migrateStrategy29Preferences(view, getValue, setValue) {
  if (!isStrategy29CompanionReady(view) || getValue(COMPLETE, false) === true) return false;
  const record = validate(view[RECORD]);
  if (getValue(ENABLED, null) === null) setValue(ENABLED, record.enabled);
  if (getValue(POSITION, null) === null && record.position !== null) setValue(POSITION, record.position);
  setValue(COMPLETE, true);
  return true;
}

/** Readiness is page-scoped; completing a previous migration does not establish a remote owner. */
export function isStrategy29CompanionReady(view) {
  if (view[RECORD] === undefined) return false;
  validate(view[RECORD]);
  return true;
}
