function combinations(items, size, start = 0, prefix = [], result = []) {
  if (prefix.length === size) {
    result.push(prefix);
    return result;
  }
  for (let index = start; index <= items.length - (size - prefix.length); index += 1) {
    combinations(items, size, index + 1, [...prefix, items[index]], result);
  }
  return result;
}

function cartesianEntries(entries, index = 0, current = {}, result = []) {
  if (index === entries.length) {
    result.push(current);
    return result;
  }
  const [key, values] = entries[index];
  for (const value of values) {
    cartesianEntries(entries, index + 1, { ...current, [key]: value }, result);
  }
  return result;
}

function tupleKey(axisKeys, scenario) {
  return JSON.stringify(axisKeys.map((key) => [key, scenario[key]]));
}

export function enumerateCartesian(axes) {
  const entries = Object.entries(axes);
  if (!entries.length || entries.some(([, values]) => !Array.isArray(values) || !values.length)) {
    throw new Error('Covering-array axes must contain non-empty value arrays');
  }
  return cartesianEntries(entries);
}

export function listCoveredTuples(scenario, axisKeys, strength) {
  if (!Number.isInteger(strength) || strength < 1 || strength > axisKeys.length) {
    throw new Error(`Invalid covering-array strength: ${strength}`);
  }
  return combinations(axisKeys, strength).map((keys) => tupleKey(keys, scenario));
}

/**
 * Greedily selects the first candidate covering the most remaining tuples.
 * Candidate and axis order provide a stable tie-break, so the matrix is reviewable
 * and reproducible without a random seed while still avoiding the Cartesian product.
 */
export function generateCoveringArray({ axes, strength = 2, isValid = () => true }) {
  const axisKeys = Object.keys(axes);
  const candidates = enumerateCartesian(axes).filter(isValid);
  if (!candidates.length) throw new Error('Covering-array constraints rejected every scenario');

  const tuplesByCandidate = candidates.map((candidate) => (
    listCoveredTuples(candidate, axisKeys, strength)
  ));
  const uncovered = new Set(tuplesByCandidate.flat());
  const selected = [];
  const available = new Set(candidates.map((_, index) => index));

  while (uncovered.size) {
    let bestIndex = -1;
    let bestCoverage = -1;
    for (const candidateIndex of available) {
      const coverage = tuplesByCandidate[candidateIndex]
        .reduce((total, tuple) => total + Number(uncovered.has(tuple)), 0);
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestIndex = candidateIndex;
      }
    }
    if (bestIndex < 0 || bestCoverage <= 0) {
      throw new Error(`Unable to cover ${uncovered.size} remaining tuples`);
    }
    selected.push(candidates[bestIndex]);
    available.delete(bestIndex);
    for (const tuple of tuplesByCandidate[bestIndex]) uncovered.delete(tuple);
  }

  return selected;
}

export function findMissingCoverage({ axes, scenarios, strength = 2, isValid = () => true }) {
  const axisKeys = Object.keys(axes);
  const required = new Set(
    enumerateCartesian(axes)
      .filter(isValid)
      .flatMap((scenario) => listCoveredTuples(scenario, axisKeys, strength))
  );
  for (const scenario of scenarios) {
    for (const tuple of listCoveredTuples(scenario, axisKeys, strength)) required.delete(tuple);
  }
  return Array.from(required);
}
