export function cmcPanelStyles(panelId) {
  const scope = `#${panelId}`;
  return `
    ${scope} {
      --cmc-bg: var(--color-PrimaryBg, light-dark(#ffffff, #181a20));
      --cmc-head: var(--color-SecondaryBg, light-dark(#fafafa, #20232b));
      --cmc-text: var(--color-TextPrimary, light-dark(#1e2329, #eaecef));
      --cmc-muted: var(--color-TextSecondary, light-dark(#5e6673, #a6afbb));
      --cmc-border: var(--color-Line, light-dark(#eaecef, #33383f));
      --cmc-accent: light-dark(#315fe8, #8aaaff);
      --cmc-buy: var(--color-Buy, light-dark(#087f5b, #0ecb81));
      --cmc-sell: var(--color-Sell, light-dark(#c42e45, #f6465d));
      position: fixed;
      top: 360px;
      right: 16px;
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - var(--cmc-panel-top, 360px) - 8px);
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      z-index: 999997;
      color: var(--cmc-text);
      background: var(--cmc-bg);
      border: 1px solid var(--cmc-border);
      border-radius: 10px;
      box-shadow: 0 6px 24px #00000020;
      font-family: BinancePlex, system-ui, -apple-system, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      text-align: left;
      overflow: hidden;
      user-select: none;
    }
    ${scope} * { box-sizing: border-box; }
    ${scope} [hidden] { display: none !important; }
    ${scope} #${panelId}-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 5px 8px;
      flex: 0 0 auto;
      cursor: move;
      background: var(--cmc-head);
      border-bottom: 1px solid var(--cmc-border);
    }
    ${scope} .cmc-heading { display: flex; align-items: center; gap: 7px; min-width: 0; }
    ${scope} .cmc-title { font-size: 14px; font-weight: 600; white-space: nowrap; }
    ${scope} #${panelId}-symbol { color: var(--cmc-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    ${scope} .cmc-controls { display: flex; gap: 2px; flex: 0 0 auto; }
    ${scope} button { font: inherit; cursor: pointer; color: inherit; background: transparent; border: 0; }
    ${scope} .cmc-controls button { min-width: 24px; min-height: 24px; font-size: 16px; padding: 2px 4px; color: var(--cmc-muted); }
    ${scope} button:focus-visible, ${scope} a:focus-visible { outline: 2px solid var(--cmc-accent); outline-offset: 2px; border-radius: 3px; }
    ${scope} #${panelId}-body { min-height: 0; overflow: auto; overscroll-behavior: contain; }
    /* Reserve space for complete prices and changes before wrapping the surrounding prose. */
    ${scope} table { width: 100%; table-layout: auto; border-collapse: collapse; }
    ${scope} .cmc-name-col { width: 33%; }
    ${scope} .cmc-value-col { width: 28%; }
    ${scope} .cmc-reading-col { width: 39%; }
    ${scope} thead { position: sticky; top: 0; z-index: 1; background: var(--cmc-head); }
    ${scope} thead th { color: var(--cmc-muted); font-size: 11px; font-weight: 500; padding: 4px 3px; text-align: left; }
    ${scope} thead th:nth-child(2) { text-align: right; }
    ${scope} thead th:last-child { text-align: right; }
    ${scope} tbody th, ${scope} tbody td { padding: 4px 3px; border-top: 1px solid var(--cmc-border); vertical-align: middle; overflow-wrap: anywhere; }
    ${scope} .cmc-name { text-align: left; font-weight: 500; }
    ${scope} small { display: block; margin-top: 1px; font-size: 11px; line-height: 1.35; color: var(--cmc-muted); }
    ${scope} .cmc-value { text-align: right; font-variant-numeric: tabular-nums; }
    ${scope} .cmc-number { display: inline-block; font-weight: 650; white-space: nowrap; }
    ${scope} .cmc-unit { display: inline-block; margin: 0 0 0 4px; }
    ${scope} .cmc-change { font-size: 11px; white-space: nowrap; }
    ${scope} .cmc-change[data-tone="positive"], ${scope} [data-tone="positive"] .cmc-reading-text { color: var(--cmc-buy); }
    ${scope} .cmc-change[data-tone="negative"], ${scope} [data-tone="negative"] .cmc-reading-text { color: var(--cmc-sell); }
    ${scope} .cmc-change[data-tone="neutral"] { color: var(--cmc-muted); }
    ${scope} .cmc-key { background: color-mix(in srgb, var(--color-PrimaryYellow, #f0b90b) 7%, var(--cmc-bg)); }
    ${scope} .cmc-group th, ${scope} .cmc-group td { border-top-width: 2px; }
    ${scope} .cmc-reading-button { display: flex; align-items: center; justify-content: flex-end; gap: 3px; width: 100%; min-height: 24px; padding: 0; line-height: inherit; text-align: right; }
    ${scope} .cmc-reading-text { font-weight: 500; }
    ${scope} [data-tone="missing"] .cmc-reading-text { color: var(--cmc-muted); }
    ${scope} [data-tone="active"] .cmc-reading-text { color: var(--cmc-accent); }
    ${scope} .cmc-info { color: var(--cmc-muted); flex: 0 0 auto; font-size: 11px; }
    ${scope} .cmc-explanation td { padding: 6px 8px; color: var(--cmc-muted); background: var(--cmc-head); font-size: 11px; line-height: 1.5; user-select: text; }
    ${scope} .cmc-explanation strong { color: var(--cmc-text); margin-right: 8px; font-weight: 600; }
    ${scope} .cmc-status { padding: 10px 0; color: var(--cmc-muted); }
    ${scope} .cmc-error-title { font-weight: 600; color: var(--cmc-sell); margin-bottom: 4px; }
    ${scope} #${panelId}-footer { padding: 5px 8px; color: var(--cmc-muted); font-size: 11px; border-top: 1px solid var(--cmc-border); }
    ${scope} .cmc-source-line { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 3px 8px; }
    ${scope} #${panelId}-footer a { color: var(--cmc-accent); text-decoration: none; }
    ${scope} .cmc-times { font-variant-numeric: tabular-nums; }
    @media (max-width: 540px) {
      ${scope} { font-size: 11px; }
      ${scope} .cmc-info { display: none; }
    }
  `;
}
