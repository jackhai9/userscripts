const OWNER_SLOT = Symbol.for('jh-userscripts.chart-mutation-owners');
const VERSION = 1;

function owners(view) {
  if (typeof view?.Map !== 'function') {
    throw new TypeError('Chart mutation protocol requires the page Map constructor');
  }
  if (view[OWNER_SLOT] === undefined) {
    Object.defineProperty(view, OWNER_SLOT, {
      // The record lives on the page window, so its collection must belong to
      // that realm too. Both page-context and userscript-sandbox bundles then
      // validate the same constructor regardless of installation load order.
      value: Object.freeze({ version: VERSION, predicates: new view.Map() }),
    });
  }
  const record = view[OWNER_SLOT];
  if (record.version !== VERSION || !(record.predicates instanceof view.Map)) {
    throw new Error('Incompatible chart mutation protocol; update both scripts and reload');
  }
  return record.predicates;
}

/** Only a synchronous boolean crosses the script boundary, never task or account data. */
export function registerChartMutationOwner(view, name, predicate) {
  const registry = owners(view);
  if (registry.has(name)) throw new Error('Duplicate chart mutation owner');
  if (typeof predicate !== 'function') throw new Error('Chart mutation owner requires a predicate');
  registry.set(name, predicate);
  return () => { if (registry.get(name) === predicate) registry.delete(name); };
}

export function isChartMutationBlocked(view) {
  for (const predicate of owners(view).values()) {
    const blocked = predicate();
    if (typeof blocked !== 'boolean') throw new Error('Chart mutation owner must return a boolean');
    if (blocked) return true;
  }
  return false;
}
