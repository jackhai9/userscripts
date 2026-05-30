function pow10(exp) {
  let result = 1n;
  for (let i = 0; i < exp; i += 1) result *= 10n;
  return result;
}

export function parseDecimalString(value) {
  const raw = String(value || '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [intPart, fracPart = ''] = raw.split('.');
  return {
    digits: BigInt(intPart + fracPart),
    scale: fracPart.length,
  };
}

export function formatDecimalParts(digits, scale) {
  const negative = digits < 0n;
  const absDigits = negative ? -digits : digits;
  const raw = absDigits.toString();
  if (scale === 0) return `${negative ? '-' : ''}${raw}`;
  const padded = raw.padStart(scale + 1, '0');
  const head = padded.slice(0, -scale) || '0';
  const tail = padded.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${tail ? `${head}.${tail}` : head}`;
}

export function normalizeDecimalString(value) {
  const parsed = parseDecimalString(value);
  return parsed ? formatDecimalParts(parsed.digits, parsed.scale) : null;
}

export function compareDecimalStrings(a, b) {
  const left = parseDecimalString(a);
  const right = parseDecimalString(b);
  if (!left || !right) return null;
  const scale = Math.max(left.scale, right.scale);
  const leftDigits = left.digits * pow10(scale - left.scale);
  const rightDigits = right.digits * pow10(scale - right.scale);
  if (leftDigits === rightDigits) return 0;
  return leftDigits > rightDigits ? 1 : -1;
}

export function addDecimalStrings(a, b) {
  const left = parseDecimalString(a);
  const right = parseDecimalString(b);
  if (!left || !right) return null;
  const scale = Math.max(left.scale, right.scale);
  const leftDigits = left.digits * pow10(scale - left.scale);
  const rightDigits = right.digits * pow10(scale - right.scale);
  return formatDecimalParts(leftDigits + rightDigits, scale);
}

export function subtractDecimalStrings(a, b) {
  const left = parseDecimalString(a);
  const right = parseDecimalString(b);
  if (!left || !right) return null;
  const scale = Math.max(left.scale, right.scale);
  const leftDigits = left.digits * pow10(scale - left.scale);
  const rightDigits = right.digits * pow10(scale - right.scale);
  if (leftDigits < rightDigits) return null;
  return formatDecimalParts(leftDigits - rightDigits, scale);
}

export function maxDecimalString(a, b) {
  if (!a) return normalizeDecimalString(b);
  if (!b) return normalizeDecimalString(a);
  const cmp = compareDecimalStrings(a, b);
  if (cmp == null) return normalizeDecimalString(a) || normalizeDecimalString(b);
  return cmp >= 0 ? normalizeDecimalString(a) : normalizeDecimalString(b);
}

export function ceilQtyByNotional(notional, price, stepSize) {
  const n = parseDecimalString(notional);
  const p = parseDecimalString(price);
  const s = parseDecimalString(stepSize);
  if (!n || !p || !s || p.digits <= 0n || s.digits <= 0n) return null;

  let numerator = n.digits;
  let denominator = p.digits * s.digits;
  const exp = p.scale + s.scale - n.scale;
  if (exp >= 0) {
    numerator *= pow10(exp);
  } else {
    denominator *= pow10(-exp);
  }

  const steps = (numerator + denominator - 1n) / denominator;
  return formatDecimalParts(steps * s.digits, s.scale);
}

export function multiplyDecimalByInt(decimalValue, intValue) {
  const raw = String(decimalValue || '').trim();
  const multiplier = String(intValue || '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  if (!/^\d+$/.test(multiplier) || Number(multiplier) <= 0) return null;

  const parts = raw.split('.');
  const intPart = parts[0];
  const fracPart = parts[1] || '';
  const scale = fracPart.length;
  const base = BigInt(intPart + fracPart);
  const multi = BigInt(multiplier);
  const product = (base * multi).toString();

  if (scale === 0) return product;

  const padded = product.padStart(scale + 1, '0');
  const head = padded.slice(0, -scale) || '0';
  const tail = padded.slice(-scale).replace(/0+$/, '');
  return tail ? `${head}.${tail}` : head;
}

export function multiplyDecimalByRatio(decimalValue, numerator, denominator) {
  const parsed = parseDecimalString(decimalValue);
  const num = parseDecimalString(numerator);
  const den = parseDecimalString(denominator);
  if (!parsed || !num || !den || num.digits <= 0n || den.digits <= 0n) return null;

  if (num.scale === 0 && den.scale === 0) {
    const digits = (parsed.digits * num.digits) / den.digits;
    return formatDecimalParts(digits, parsed.scale);
  }

  const denominatorIntegerDigits = Math.max(0, den.digits.toString().length - den.scale);
  const resultScale = parsed.scale + num.scale + Math.max(0, denominatorIntegerDigits - 1);
  let scaledNumerator = parsed.digits * num.digits;
  let scaledDenominator = den.digits;
  const scaleExp = den.scale + resultScale - parsed.scale - num.scale;
  if (scaleExp >= 0) {
    scaledNumerator *= pow10(scaleExp);
  } else {
    scaledDenominator *= pow10(-scaleExp);
  }
  const digits = scaledNumerator / scaledDenominator;
  return formatDecimalParts(digits, resultScale);
}

export function floorDecimalToStep(decimalValue, stepSize) {
  const value = parseDecimalString(decimalValue);
  const step = parseDecimalString(stepSize);
  if (!value || !step || step.digits <= 0n) return null;
  const scale = Math.max(value.scale, step.scale);
  const valueDigits = value.digits * pow10(scale - value.scale);
  const stepDigits = step.digits * pow10(scale - step.scale);
  const steps = valueDigits / stepDigits;
  return formatDecimalParts(steps * step.digits, step.scale);
}

export function isPositiveDecimalString(value) {
  const parsed = parseDecimalString(value);
  return !!parsed && parsed.digits > 0n;
}

export function isDecimalAtLeast(value, minimum) {
  const cmp = compareDecimalStrings(value, minimum);
  return cmp != null && cmp >= 0;
}
