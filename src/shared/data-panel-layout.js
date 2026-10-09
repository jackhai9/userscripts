export const DATA_PANEL_LAYOUT_EVENT = 'jh-data-panels-layout-change';
export const DATA_PANEL_WIDTH = 384;

const PANEL_IDS = Object.freeze({
  trading: 'jh-binance-trading-data-panel',
  cmc: 'jh-binance-cmc-data-panel',
});
const TWO_COLUMN_WIDTH = DATA_PANEL_WIDTH * 2 + 48;

export function hasVisibleDataPanelPeer(document, kind) {
  const peer = document.getElementById(PANEL_IDS[kind === 'trading' ? 'cmc' : 'trading']);
  return peer !== null && peer.style.display !== 'none';
}

/** Saved positions are already viewport-projected by the caller and remain authoritative. */
export function calculateDataPanelLayout({ kind, panelWidth, viewportWidth, viewportHeight, savedPosition, hasPeer }) {
  if (kind !== 'trading' && kind !== 'cmc') throw new Error('Unknown data panel kind');
  if (savedPosition !== null) {
    return { ...savedPosition, maxHeight: Math.max(48, viewportHeight - savedPosition.top - 8) };
  }
  const stacked = hasPeer && viewportWidth < TWO_COLUMN_WIDTH;
  const sectionHeight = Math.max(48, Math.floor((viewportHeight - 24) / 2));
  const targetTop = stacked ? kind === 'trading' ? 8 : 16 + sectionHeight : 60;
  const top = Math.max(0, Math.min(targetTop, viewportHeight - 48));
  const peerWidth = hasPeer && !stacked && kind === 'cmc' ? DATA_PANEL_WIDTH + 16 : 0;
  const targetLeft = viewportWidth - panelWidth - 16 - peerWidth;
  const left = Math.max(0, Math.min(Math.max(stacked ? 8 : 16, targetLeft), viewportWidth - panelWidth));
  const availableHeight = Math.max(48, viewportHeight - top - 8);
  return { left, top, maxHeight: stacked ? Math.min(sectionHeight, availableHeight) : availableHeight };
}
