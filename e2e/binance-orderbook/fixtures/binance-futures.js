function escapeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function renderBinanceFuturesFixture(scenario) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Binance Futures UI Fixture</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; color: #1e2329; background: #fafafa; }
    button, [role="tab"], [role="checkbox"], .cursor-pointer { cursor: pointer; }
    #fixture-layout { display: grid; grid-template-columns: 1fr 360px; gap: 16px; min-height: 900px; padding: 20px; }
    #fixture-main, #trade-form, .react-grid-item { background: #fff; border: 1px solid #eaecef; }
    #fixture-main { min-width: 700px; padding: 16px; }
    #trade-form { position: relative; width: 340px; min-height: 640px; padding: 12px; }
    .trade-header { position: relative; }
    .quick-controls { height: 32px; margin-bottom: 8px; }
    .trade-mode-row { display: block; width: 100%; }
    .trade-mode-column { width: 100%; }
    #position-direction, #account-tabs, .sub-tabs { display: flex; gap: 8px; }
    [role="tab"] { min-width: 80px; min-height: 30px; padding: 6px 10px; border: 1px solid #d8dce1; }
    [role="tab"][aria-selected="true"] { background: #f0b90b22; border-color: #f0b90b; }
    .order-type-tabs, .available-balance, .order-entry { min-height: 38px; padding-top: 8px; }
    .order-entry button { width: 48%; height: 36px; }
    #futuresOrderbook { width: 300px; min-height: 300px; }
    .orderbook-tickSize, .row-content, .tradew-tradelist { min-height: 24px; }
    .row-content { display: flex; gap: 16px; }
    .emit-price { display: inline-block; min-width: 70px; min-height: 20px; }
    .chart-widget-root { width: 700px; height: 300px; margin-top: 20px; border: 1px solid #d8dce1; }
    .chart-widget-root iframe { width: 100%; height: 100%; border: 0; }
    .react-grid-item { margin: 16px 20px; min-height: 240px; padding: 12px; }
    #account-tabs { margin-bottom: 12px; }
    #OPEN_ORDERS { min-height: 160px; padding: 10px; }
    [role="checkbox"] { display: inline-block; min-width: 150px; min-height: 28px; padding: 4px 8px; border: 1px solid #d8dce1; }
    .open-order-row { display: grid; grid-template-columns: repeat(10, minmax(60px, 1fr)); min-height: 28px; margin-top: 6px; }
    .cursor-pointer { display: inline-block; min-width: 60px; min-height: 28px; margin-top: 8px; padding: 4px 8px; border: 1px solid #d8dce1; }
    .bn-modal-root { position: fixed; inset: 0; z-index: 1000000; background: #0003; display: grid; place-items: center; }
    [role="dialog"] { width: 340px; min-height: 150px; padding: 20px; background: #fff; }
    [role="dialog"] button { width: 120px; height: 36px; margin: 24px 8px 0 0; }
  </style>
  <script src="/__binance_orderbook_userscript__.js"></script>
</head>
<body>
  <div id="fixture-layout">
    <main id="fixture-main">
      <section id="futuresOrderbook">
        <div class="orderbook-tickSize"><span class="tick-content">0.1</span></div>
        <div class="row-content"><span class="ask-light emit-price">81.2</span></div>
        <div class="row-content"><span class="ask-light emit-price">81.1</span></div>
        <div class="row-content"><span class="bid-light emit-price">81.0</span></div>
        <div class="row-content"><span class="bid-light emit-price">80.9</span></div>
      </section>
      <section class="tradew-tradelist">
        <span class="price emit-price">81.00</span><span class="price emit-price">81.01</span>
        <span class="price emit-price">81.02</span><span class="price emit-price">81.03</span>
        <span class="price emit-price">81.04</span><span class="price emit-price">81.05</span>
      </section>
      <section class="chart-widget-root"><iframe title="TradingView chart"></iframe></section>
    </main>
    <section id="trade-form">
      <div class="trade-header">
        <div class="quick-controls"><button type="button">全仓</button> <button type="button">2x</button></div>
        <div class="trade-mode-row">
          <div class="trade-mode-column">
            <div id="position-direction">
              <div role="tab" aria-selected="true">开仓</div>
              <div role="tab" aria-selected="false">平仓</div>
            </div>
            <div class="order-type-tabs"><div role="tab" data-tab-key="POST_ONLY" aria-selected="true">只做Maker</div></div>
          </div>
        </div>
        <div class="available-balance"><span>可用</span><span>100.00 USDT</span></div>
      </div>
      <div class="order-entry">
        <input id="limitPrice-open" value="81.0"><input id="unitAmount-open" value="">
        <button type="button">开多</button><button type="button">开空</button>
      </div>
    </section>
  </div>
  <section id="account-widget" class="react-grid-item"></section>
  <script id="__APP_DATA" type="application/json">{"appState":{"loader":{"dataByRouteId":{"bd56":{"reactQueryData":{"queryMarkPrice,HYPEUSDT":{"markPrice":"81.0"}}}}}}}</script>
  <script>
    (() => {
      const scenario = ${escapeJsonForScript(scenario)};
      const state = {
        positions: scenario.positions.map((item) => ({ ...item })),
        orders: scenario.orders.map((item) => ({ ...item })),
        accountTab: scenario.ui.accountTab,
        openOrdersSubTab: scenario.ui.openOrdersSubTab,
        hideOtherSymbols: scenario.ui.hideOtherSymbols,
        showOrders: scenario.ui.showOrders,
        dialogOpen: false,
        events: [],
      };
      const accountWidget = document.querySelector('#account-widget');
      const record = (type, detail = {}) => state.events.push({
        type,
        at: performance.now(),
        ...detail,
      });
      const currentOrders = () => state.orders.filter((item) => item.symbol === scenario.currentSymbol);
      const visibleOrders = () => state.hideOtherSymbols ? currentOrders() : state.orders;
      const selected = (value, expected) => String(value === expected);
      const scheduleCommit = (callback) => setTimeout(callback, scenario.host.mutationDelayMs);

      localStorage.setItem('jh_binance_ladder_expanded', scenario.ui.ladderExpanded ? 'true' : 'false');
      localStorage.setItem('jh_binance_orderbook_precision_samples_v3:' + scenario.currentSymbol, '["81.0","81.01","81.02","81.03","81.04","81.05"]');

      function renderOrdersRows() {
        const orders = visibleOrders();
        if (!orders.length) return '<div data-empty-orders>暂无当前委托。</div>';
        return orders.map((item) => '<div class="open-order-row" data-order-id="' + item.id + '">' +
          '<span>' + item.symbol + ' 永续</span> <span>限价</span> <span>' + item.side + '</span> ' +
          '<span>' + item.price + '</span> <span>' + item.quantity + '</span> ' +
          '<span>0</span> <span>只做Maker</span> <span>--</span> <span>--</span> <span>--</span>' +
          '</div>').join('');
      }

      function renderAccountWidget() {
        const positionCount = state.positions.length;
        const orderCount = state.orders.length;
        accountWidget.innerHTML =
          '<div id="account-tabs">' +
            '<div role="tab" data-account-tab="positions" aria-selected="' + selected(state.accountTab, 'positions') + '">仓位(' + positionCount + ')</div>' +
            '<div role="tab" data-account-tab="openOrders" aria-selected="' + selected(state.accountTab, 'openOrders') + '">当前委托(' + orderCount + ')</div>' +
            '<div role="tab" data-account-tab="history" aria-selected="' + selected(state.accountTab, 'history') + '">历史委托</div>' +
          '</div>' +
          '<div id="OPEN_ORDERS" style="display:' + (state.accountTab === 'openOrders' ? 'block' : 'none') + '">' +
            '<div class="sub-tabs">' +
              '<div role="tab" data-open-orders-sub-tab="basic" aria-selected="' + selected(state.openOrdersSubTab, 'basic') + '">基础单(' + orderCount + ')</div>' +
              '<div role="tab" data-open-orders-sub-tab="conditional" aria-selected="' + selected(state.openOrdersSubTab, 'conditional') + '">条件委托(0)</div>' +
            '</div>' +
            '<div role="checkbox" name="hideOtherSymbol" aria-checked="' + state.hideOtherSymbols + '">隐藏其他合约</div>' +
            '<div class="orders-content" style="display:' + (state.openOrdersSubTab === 'basic' ? 'block' : 'none') + '">' + renderOrdersRows() + '</div>' +
            (state.openOrdersSubTab === 'basic' && visibleOrders().length ? '<div class="cursor-pointer" data-cancel-all>全撤</div>' : '') +
          '</div>';

        accountWidget.querySelectorAll('[data-account-tab]').forEach((tab) => {
          tab.addEventListener('click', () => scheduleCommit(() => {
            state.accountTab = tab.dataset.accountTab;
            record('account-tab', { value: state.accountTab });
            renderAccountWidget();
          }));
        });
        accountWidget.querySelectorAll('[data-open-orders-sub-tab]').forEach((tab) => {
          tab.addEventListener('click', () => scheduleCommit(() => {
            state.openOrdersSubTab = tab.dataset.openOrdersSubTab;
            record('open-orders-sub-tab', { value: state.openOrdersSubTab });
            renderAccountWidget();
          }));
        });
        accountWidget.querySelector('[name="hideOtherSymbol"]')?.addEventListener('click', () => scheduleCommit(() => {
          state.hideOtherSymbols = !state.hideOtherSymbols;
          record('hide-other-symbols', { value: state.hideOtherSymbols });
          renderAccountWidget();
        }));
        accountWidget.querySelector('[data-cancel-all]')?.addEventListener('click', openCancelDialog);
      }

      function closeDialog(action) {
        document.querySelector('.bn-modal-root')?.remove();
        state.dialogOpen = false;
        record('dialog-closed', { action });
      }

      function openCancelDialog() {
        if (state.dialogOpen) throw new Error('Fixture opened a duplicate cancel dialog');
        state.dialogOpen = true;
        record('dialog-opened');
        const root = document.createElement('div');
        root.className = 'bn-modal-root';
        root.innerHTML = '<div role="dialog"><div class="bn-modal-title">确定取消全部订单？</div>' +
          '<button type="button" data-dialog-action="cancel">取消</button>' +
          '<button type="button" class="bn-button bn-button__primary" data-dialog-action="confirm"><span>确认</span></button></div>';
        document.body.append(root);
        root.querySelector('[data-dialog-action="cancel"]').addEventListener('click', () => closeDialog('cancel'));
        root.querySelector('[data-dialog-action="confirm"]').addEventListener('click', () => {
          record('cancel-requested', { symbol: scenario.currentSymbol });
          setTimeout(() => {
            state.orders = state.orders.filter((item) => item.symbol !== scenario.currentSymbol);
            closeDialog('confirm');
            renderAccountWidget();
          }, scenario.host.clearDelayMs);
        });
      }

      const chart = {
        properties() {
          return { tradingProperties: { showOrders: { value: () => state.showOrders } } };
        },
        applyOverrides(overrides) {
          state.showOrders = overrides['tradingProperties.showOrders'];
          record('show-orders', { value: state.showOrders });
        },
      };
      document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi = {
        activeChart: () => chart,
      };

      window.__BINANCE_FIXTURE__ = {
        snapshot: () => JSON.parse(JSON.stringify({
          positions: state.positions,
          orders: state.orders,
          accountTab: state.accountTab,
          openOrdersSubTab: state.openOrdersSubTab,
          hideOtherSymbols: state.hideOtherSymbols,
          showOrders: state.showOrders,
          dialogOpen: state.dialogOpen,
          events: state.events,
        })),
      };
      renderAccountWidget();
    })();
  </script>
</body>
</html>`;
}
