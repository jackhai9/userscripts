const OWNER_SLOT = Symbol.for('jh-userscripts.chart-mutation-owners');
const VERSION = 1;

function owners(view) {
  if (view[OWNER_SLOT] === undefined) {
    Object.defineProperty(view, OWNER_SLOT, {
      value: Object.freeze({ version: VERSION, predicates: new Map() }),
    });
  }
  const record = view[OWNER_SLOT];
  if (record.version !== VERSION || !(record.predicates instanceof Map)) {
    throw new Error('Incompatible chart mutation protocol; update both scripts and reload');
  }
  return record.predicates;
}

function existingOwners(view) {
  const record = view[OWNER_SLOT];
  if (record === undefined) return null;
  if (typeof view?.Map !== 'function' || record.version !== VERSION || !(record.predicates instanceof view.Map)) {
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
  const registry = existingOwners(view);
  if (registry === null) return false;
  for (const predicate of registry.values()) {
    const blocked = predicate();
    if (typeof blocked !== 'boolean') throw new Error('Chart mutation owner must return a boolean');
    if (blocked) return true;
  }
  return false;
}
