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
    .orderbook-tickSize { position: relative; width: 120px; }
    .bn-tooltips-ele { display: inline-block; min-width: 70px; min-height: 24px; }
    .ob-ticksize-overlay { position: absolute; top: 24px; left: 0; z-index: 20; width: 120px; padding: 4px; background: #fff; border: 1px solid #d8dce1; }
    .ob-ticksize-item { display: block; min-height: 28px; padding: 4px; }
    .row-content { display: flex; gap: 16px; }
    .emit-price { display: inline-block; min-width: 70px; min-height: 20px; }
    .chart-widget-root { width: 700px; height: 300px; margin-top: 20px; border: 1px solid #d8dce1; }
    .chart-toolbar { display: flex; align-items: center; gap: 12px; height: 32px; padding: 6px; }
    .chart-toolbar .bn-tooltips-wrap { display: inline-block; min-width: 24px; min-height: 18px; }
    .chart-orders-popover { position: absolute; z-index: 50; display: none; padding: 8px; background: #fff; border: 1px solid #d8dce1; }
    .chart-orders-popover.active { display: block; }
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
        <div class="orderbook-tickSize"><div class="bn-tooltips-ele"><span class="tick-content">0.1</span></div></div>
        <div class="row-content"><span class="ask-light emit-price">81.2</span></div>
        <div class="row-content"><span class="ask-light emit-price">81.1</span></div>
        <div class="row-content"><span class="ask-light emit-price">81.05</span></div>
        <div class="row-content"><span class="ask-light emit-price">81.04</span></div>
        <div class="row-content"><span class="ask-light emit-price">81.03</span></div>
        <div class="row-content"><span class="ask-light emit-price">81.02</span></div>
        <div class="row-content"><span class="bid-light emit-price">81.0</span></div>
        <div class="row-content"><span class="bid-light emit-price">80.9</span></div>
        <div class="row-content"><span class="bid-light emit-price">80.8</span></div>
        <div class="row-content"><span class="bid-light emit-price">80.7</span></div>
        <div class="row-content"><span class="bid-light emit-price">80.6</span></div>
        <div class="row-content"><span class="bid-light emit-price">80.5</span></div>
      </section>
      <section class="tradew-tradelist">
        <span class="price emit-price">81.00</span><span class="price emit-price">81.01</span>
        <span class="price emit-price">81.02</span><span class="price emit-price">81.03</span>
        <span class="price emit-price">81.04</span><span class="price emit-price">81.05</span>
      </section>
      <section class="chart-widget-root">
        <div class="chart-toolbar flex items-center gap-[--space-m]">
          <span>intervals</span>
          <span class="bn-tooltips-wrap bn-tooltips-web" data-testid="chart-screenshot">shot</span>
          <span class="bn-tooltips-wrap bn-tooltips-web" data-testid="chart-orders-trigger">
            <span class="bn-tooltips-ele" aria-describedby="chart-orders-menu">orders</span>
          </span>
          <span class="bn-tooltips-wrap bn-tooltips-web w-full cursor-pointer">最新价格</span>
        </div>
        <iframe title="TradingView chart"></iframe>
      </section>
      <div id="chart-orders-menu" role="tooltip" class="bn-bubble chart-orders-popover"></div>
    </main>
    <section id="trade-form">
      <div class="trade-header">
        <div class="quick-controls"><button type="button">全仓</button> <button type="button">2x</button></div>
        <div class="trade-mode-row">
          <div class="trade-mode-column">
            <div id="position-direction">
              <div role="tab" data-trade-mode="OPEN" aria-selected="true">开仓</div>
              <div role="tab" data-trade-mode="CLOSE" aria-selected="false">平仓</div>
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
        tradeMode: scenario.ui.tradeMode,
        orderbookPrecision: scenario.ui.orderbookPrecision,
        leverage: scenario.ui.leverage,
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
      let orderSubmitSequence = 0;
      const userscriptFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await userscriptFetch(...args);
        const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
        if (url.pathname === '/bapi/futures/v1/private/future/user-data/adjustLeverage' && response.ok) {
          const body = JSON.parse(args[1].body);
          state.leverage = body.leverage;
          document.querySelector('.quick-controls button:nth-child(2)').textContent = body.leverage + 'x';
          record('leverage-adjusted', { symbol: body.symbol, leverage: body.leverage });
        }
        return response;
      };

      function currentPositionQuantity(side) {
        return state.positions
          .filter((item) => item.symbol === scenario.currentSymbol && item.side === side)
          .reduce((total, item) => total + Number(item.quantity), 0);
      }

      function renderTradeMode() {
        const direction = document.querySelector('#position-direction');
        direction.innerHTML =
          '<div role="tab" data-trade-mode="OPEN" aria-selected="' + selected(state.tradeMode, 'OPEN') + '">开仓</div>' +
          '<div role="tab" data-trade-mode="CLOSE" aria-selected="' + selected(state.tradeMode, 'CLOSE') + '">平仓</div>';
        const orderEntry = document.querySelector('.order-entry');
        if (state.tradeMode === 'OPEN') {
          orderEntry.innerHTML =
            '<input id="limitPrice-open" value="81.0"><input id="unitAmount-open" value="">' +
            '<button type="button">开多</button><button type="button">开空</button>' +
            '<div data-testid="max-buy-amount">可开 10 HYPE</div>' +
            '<div data-testid="max-sell-amount">可开 10 HYPE</div>';
        } else {
          orderEntry.innerHTML =
            '<input id="limitPrice-close" value="81.0"><input id="unitAmount-close" value="">' +
            '<button type="button">平多</button><button type="button">平空</button>' +
            '<div data-testid="max-sell-amount">可平 ' + currentPositionQuantity('LONG') + ' HYPE</div>' +
            '<div data-testid="max-buy-amount">可平 ' + currentPositionQuantity('SHORT') + ' HYPE</div>';
        }
        direction.querySelectorAll('[data-trade-mode]').forEach((tab) => {
          tab.addEventListener('click', () => scheduleCommit(() => {
            state.tradeMode = tab.dataset.tradeMode;
            record('trade-mode', { value: state.tradeMode });
            renderTradeMode();
          }));
        });
        orderEntry.querySelectorAll('button').forEach((button) => {
          button.addEventListener('click', () => {
            const busyAttribute = scenario.host.submitButtonBusyAttribute;
            if (button.getAttribute(busyAttribute) === 'true') {
              record('order-submit-while-busy', { action: button.textContent.trim() });
              return;
            }
            if (scenario.host.submitButtonBusyMs > 0) {
              button.setAttribute(busyAttribute, 'true');
              record('submit-button-busy', { action: button.textContent.trim() });
              setTimeout(() => {
                if (scenario.host.submitButtonClearsInputsWhenReady) {
                  orderEntry.querySelectorAll('input').forEach((input) => {
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                  });
                  record('native-submit-cleanup-cleared-inputs');
                }
                button.removeAttribute(busyAttribute);
                record('submit-button-ready', { action: button.textContent.trim() });
              }, scenario.host.submitButtonBusyMs);
            }
            orderSubmitSequence += 1;
            const submitSequence = orderSubmitSequence;
            record('order-submitted', {
              submitSequence,
              action: button.textContent.trim(),
              price: orderEntry.querySelector('input[id^="limitPrice-"]')?.value || '',
              quantity: orderEntry.querySelector('input[id^="unitAmount-"]')?.value || '',
            });
            window.fetch('/bapi/futures/v1/private/future/order/place-order', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ submitSequence }),
            }).then(() => record('order-submit-api-success', { submitSequence }));
            const showFeedback = () => {
              const feedback = document.createElement('div');
              feedback.setAttribute('role', 'alert');
              feedback.textContent = '订单已提交成功';
              document.body.append(feedback);
              record('order-submit-feedback', { action: button.textContent.trim(), submitSequence });
            };
            if (scenario.host.submitFeedbackDelayMs > 0) {
              setTimeout(showFeedback, scenario.host.submitFeedbackDelayMs);
            } else {
              showFeedback();
            }
          });
        });
        orderEntry.querySelectorAll('input').forEach((input) => {
          input.addEventListener('input', () => {
            record('trade-input-written', { id: input.id, value: input.value });
          });
        });
      }

      function renderPrecisionOverlay() {
        const tickSize = document.querySelector('#futuresOrderbook .orderbook-tickSize');
        const existing = tickSize.querySelector('.ob-ticksize-overlay');
        if (existing) {
          existing.remove();
          record('precision-overlay-closed');
          return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'ob-ticksize-overlay';
        overlay.innerHTML = scenario.host.precisionOptions.map((value) => (
          '<div class="ob-ticksize-item" data-precision-value="' + value + '"><span>' + value + '</span></div>'
        )).join('');
        tickSize.append(overlay);
        record('precision-overlay-opened');
        overlay.querySelectorAll('[data-precision-value]').forEach((option) => {
          option.addEventListener('click', () => {
            state.orderbookPrecision = option.dataset.precisionValue;
            tickSize.querySelector('.tick-content').textContent = state.orderbookPrecision;
            record('precision-selected', { value: state.orderbookPrecision });
            overlay.remove();
          });
        });
      }

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
        document.removeEventListener('keydown', handleDialogKeydown);
        document.querySelector('.bn-modal-root')?.remove();
        state.dialogOpen = false;
        record('dialog-closed', { action });
      }

      function handleDialogKeydown(event) {
        if (event.key === 'Escape' && state.dialogOpen) closeDialog('escape');
      }

      function attachDialogHandlers(root) {
        root.addEventListener('click', (event) => {
          if (event.target === root) closeDialog('backdrop');
        });
        root.querySelector('[data-dialog-action="cancel"]').addEventListener('click', () => closeDialog('cancel'));
        root.querySelector('[data-dialog-action="confirm"]').addEventListener('click', () => {
          record('cancel-requested', { symbol: scenario.currentSymbol });
          setTimeout(() => {
            if (scenario.host.clearMode === 'currentSymbol') {
              state.orders = state.orders.filter((item) => item.symbol !== scenario.currentSymbol);
            }
            closeDialog('confirm');
            renderAccountWidget();
          }, scenario.host.clearDelayMs);
        });
      }

      function openCancelDialog() {
        if (state.dialogOpen) throw new Error('Fixture opened a duplicate cancel dialog');
        if (scenario.host.dialogMode === 'missing') {
          record('dialog-missing');
          return;
        }
        state.dialogOpen = true;
        record('dialog-opened');
        const root = document.createElement('div');
        root.className = 'bn-modal-root';
        const primaryClass = scenario.host.dialogMode === 'missingPrimary'
          ? ''
          : ' class="bn-button bn-button__primary"';
        const extraAction = scenario.host.dialogMode === 'extraAction'
          ? '<button type="button" data-dialog-action="extra">稍后</button>'
          : '';
        root.innerHTML = '<div role="dialog"><div class="bn-modal-title">确定取消全部订单？</div>' +
          '<button type="button" data-dialog-action="cancel">取消</button>' +
          '<button type="button"' + primaryClass + ' data-dialog-action="confirm"><span>确认</span></button>' +
          extraAction + '</div>';
        document.body.append(root);
        document.addEventListener('keydown', handleDialogKeydown);
        attachDialogHandlers(root);
        if (scenario.host.dialogReplacementDelayMs !== null) {
          setTimeout(() => {
            if (!state.dialogOpen || !root.isConnected) return;
            const replacement = root.cloneNode(true);
            root.replaceWith(replacement);
            attachDialogHandlers(replacement);
            record('dialog-replaced');
          }, scenario.host.dialogReplacementDelayMs);
        }
      }

      const chartOrdersPopover = document.querySelector('#chart-orders-menu');
      const chartOrdersTrigger = document.querySelector('[data-testid="chart-orders-trigger"]');
      const chartRoot = document.querySelector('.chart-widget-root');
      const chartEventListeners = new Map();
      const tradingViewApi = {
        saveChart(snapshot) {
          record('chart-saved', { snapshot });
        },
        subscribe(eventName, listener) {
          const listeners = chartEventListeners.get(eventName) || new Set();
          listeners.add(listener);
          chartEventListeners.set(eventName, listeners);
        },
        unsubscribe(eventName, listener) {
          const listeners = chartEventListeners.get(eventName);
          if (!listeners?.delete(listener)) {
            throw new Error('Fixture could not unsubscribe the TradingView listener');
          }
          if (!listeners.size) chartEventListeners.delete(eventName);
        },
        emit(eventName, ...args) {
          for (const listener of chartEventListeners.get(eventName) || []) listener(...args);
        },
      };

      function renderChartOrdersPopover() {
        chartOrdersPopover.innerHTML =
          '<div role="checkbox" aria-checked="true">仓位</div>' +
          '<div role="checkbox" data-chart-orders-checkbox aria-checked="' + state.showOrders + '">当前委托</div>' +
          '<div role="checkbox" aria-checked="true">止盈止损</div>';
        chartOrdersPopover.querySelector('[data-chart-orders-checkbox]').addEventListener('click', () => {
          const nextChecked = !state.showOrders;
          const drawings = currentOrders().map((order) => ({ ...order }));
          state.showOrders = nextChecked;
          renderChartOrdersPopover();
          record('chart-orders-checked', { value: nextChecked, drawings: drawings.length });
          drawings.forEach((order, index) => {
            setTimeout(() => {
              tradingViewApi.emit(
                'drawing_event',
                'order-' + order.id,
                nextChecked ? 'properties_changed' : 'remove',
              );
              record('chart-save-requested', {
                checked: nextChecked,
                index,
                orderId: order.id,
              });
              tradingViewApi.saveChart({
                checked: nextChecked,
                drawingCount: drawings.length,
                finalOrderId: order.id,
              });
            }, scenario.host.mutationDelayMs + (index * 2));
          });
        });
      }

      function openChartOrdersPopover() {
        chartOrdersPopover.classList.add('active');
        record('chart-orders-popover-opened');
      }

      function closeChartOrdersPopover() {
        if (!chartOrdersPopover.classList.contains('active')) return;
        record('chart-orders-popover-close-requested');
        if (scenario.host.chartOrdersPopoverCloseMode === 'stuck') return;
        chartOrdersPopover.classList.remove('active');
        record('chart-orders-popover-closed');
      }

      chartOrdersTrigger.addEventListener('mouseenter', openChartOrdersPopover);
      chartRoot.addEventListener('mouseenter', (event) => {
        if (event.target === chartRoot) closeChartOrdersPopover();
      });
      document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi = tradingViewApi;
      renderChartOrdersPopover();

      window.__BINANCE_FIXTURE__ = {
        snapshot: () => JSON.parse(JSON.stringify({
          positions: state.positions,
          orders: state.orders,
          accountTab: state.accountTab,
          openOrdersSubTab: state.openOrdersSubTab,
          hideOtherSymbols: state.hideOtherSymbols,
          showOrders: state.showOrders,
          tradeMode: state.tradeMode,
          orderbookPrecision: state.orderbookPrecision,
          leverage: state.leverage,
          dialogOpen: state.dialogOpen,
          events: state.events,
        })),
      };
      document.querySelector('.tick-content').textContent = state.orderbookPrecision;
      document.querySelector('.quick-controls button:nth-child(2)').textContent = state.leverage + 'x';
      document.querySelector('.bn-tooltips-ele').addEventListener('click', renderPrecisionOverlay);
      renderTradeMode();
      renderAccountWidget();
      window.fetch('/bapi/fixture-bootstrap', {
        headers: { csrftoken: 'fixture' },
      });
    })();
  </script>
</body>
</html>`;
}
