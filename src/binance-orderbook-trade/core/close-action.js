export function resolveConfirmedCloseDirection(closeContext, selectedSide) {
  if (!closeContext?.knowsLong || !closeContext?.knowsShort) return null;
  if (closeContext.hasLong && closeContext.hasShort) {
    return selectedSide === 'SHORT' ? 'SHORT' : 'LONG';
  }
  if (closeContext.hasLong) return 'LONG';
  if (closeContext.hasShort) return 'SHORT';
  return null;
}
