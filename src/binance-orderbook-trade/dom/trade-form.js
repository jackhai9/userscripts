function buttonTextMatches(button, patterns) {
  const text = (button?.textContent || '').trim().toLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}

function isOwnPanelButton(button, panelId) {
  return !!button?.closest?.(`#${panelId}`);
}

export function isTradeModeTab(node, { panelId }) {
  if (!node?.matches?.('[role="tab"]')) return false;
  if (node.closest(`#${panelId}`)) return false;
  if (
    !node.matches('#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [role="tab"].bn-tab__buySell')
  ) {
    return false;
  }
  const text = (node.textContent || '').trim();
  return text.includes('开仓') || text.includes('平仓');
}

export function isTradeActionButton(node, { panelId }) {
  if (!node?.matches) return false;
  const button = node.matches('button') ? node : node.closest('button');
  if (!button || isOwnPanelButton(button, panelId)) return false;
  return buttonTextMatches(button, [
    '开多',
    'open long',
    '开空',
    'open short',
    '平多',
    'close long',
    '平空',
    'close short',
  ]);
}

export function collectTradeButtonsFromScopes(scopes, mode, {
  panelId,
  isVisibleElement,
}) {
  const modePatterns = mode === 'OPEN'
    ? ['开多', 'open long', '开空', 'open short']
    : ['平多', 'close long', '平空', 'close short'];
  const buttons = [];
  const seen = new Set();
  const collectFrom = (scope) => {
    if (!scope) return;
    for (const candidate of scope.querySelectorAll('button')) {
      if (seen.has(candidate) || isOwnPanelButton(candidate, panelId) || !isVisibleElement(candidate)) continue;
      seen.add(candidate);
      if (buttonTextMatches(candidate, modePatterns)) buttons.push(candidate);
    }
  };

  for (const scope of scopes) collectFrom(scope);
  return buttons;
}
