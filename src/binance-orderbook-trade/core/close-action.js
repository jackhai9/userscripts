export function resolveConfirmedCloseDirection(closeContext, selectedSide) {
  if (!closeContext?.knowsLong || !closeContext?.knowsShort) return null;
  if (closeContext.hasLong && closeContext.hasShort) {
    return selectedSide === 'SHORT' ? 'SHORT' : 'LONG';
  }
  if (closeContext.hasLong) return 'LONG';
  if (closeContext.hasShort) return 'SHORT';
  return null;
}

export function resolveCloseDisplayQuantities({
  rawLongQty,
  rawShortQty,
  cachedLongQty = null,
  cachedShortQty = null,
  transitionPending = false,
}) {
  if (transitionPending) {
    return {
      longQty: cachedLongQty,
      shortQty: cachedShortQty,
      isUsingCache: cachedLongQty != null || cachedShortQty != null,
      shouldCommit: false,
    };
  }

  return {
    longQty: rawLongQty ?? cachedLongQty,
    shortQty: rawShortQty ?? cachedShortQty,
    isUsingCache: (rawLongQty == null && cachedLongQty != null)
      || (rawShortQty == null && cachedShortQty != null),
    shouldCommit: rawLongQty != null || rawShortQty != null,
  };
}
