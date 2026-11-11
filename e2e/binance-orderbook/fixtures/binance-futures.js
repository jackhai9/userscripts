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
    .bn-select-bubble { position: fixed; z-index: 20; width: 120px; padding: 4px; background: #fff; border: 1px solid #d8dce1; }
    .bn-select-option { display: block; min-height: 28px; padding: 4px; }
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
    .open-order-row { display: grid; grid-template-columns: repeat(12, minmax(60px, 1fr)); min-height: 28px; margin-top: 6px; }
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
        <div class="orderbook-tickSize"><div class="bn-tooltips-wrap bn-tooltips-web bn-select bn-select__auto"><div class="bn-tooltips-ele bn-select-trigger"><span class="tick-content">0.1</span></div></div></div>
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
            <div class="order-type-tabs"></div>
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
        openableQuantity: scenario.ui.openableQuantity,
        orderType: 'POST_ONLY',
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
      const visibleOrders = () => state.orders.filter((item) => (
        item.kind === state.openOrdersSubTab
        && (!state.hideOtherSymbols || item.symbol === scenario.currentSymbol)
      ));
      const selected = (value, expected) => String(value === expected);
      const scheduleCommit = (callback) => setTimeout(callback, scenario.host.mutationDelayMs);
      let orderSubmitSequence = 0;
      let loadedOrderCount = scenario.host.orderRowsPageSize;
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

      const ORDER_TYPE_LABELS = { LIMIT: '限价', MARKET: '市价', POST_ONLY: '只做Maker' };

      function renderOrderTypeTabs() {
        const tabs = document.querySelector('.order-type-tabs');
        tabs.innerHTML = scenario.host.orderTypeTabs.map((key) => (
          '<div role="tab" data-tab-key="' + key + '" aria-selected="' + selected(state.orderType, key) + '">'
          + ORDER_TYPE_LABELS[key] + '</div>'
        )).join('');
        if (!scenario.host.orderTypeTabsInteractive) return;
        tabs.querySelectorAll('[data-tab-key]').forEach((tab) => {
          tab.addEventListener('click', () => scheduleCommit(() => {
            state.orderType = tab.dataset.tabKey;
            record('order-type', { value: state.orderType });
            renderOrderTypeTabs();
            renderTradeMode();
          }));
        });
      }

      function renderTradeMode() {
        const direction = document.querySelector('#position-direction');
        direction.innerHTML =
          '<div role="tab" data-trade-mode="OPEN" aria-selected="' + selected(state.tradeMode, 'OPEN') + '">开仓</div>' +
          '<div role="tab" data-trade-mode="CLOSE" aria-selected="' + selected(state.tradeMode, 'CLOSE') + '">平仓</div>';
        const orderEntry = document.querySelector('.order-entry');
        // A market form has no price input, as observed on the live MARKET tab.
        const priceInput = (mode) => (state.orderType === 'MARKET' ? '' : '<input id="limitPrice-' + mode + '" value="81.0">');
        if (state.tradeMode === 'OPEN') {
          orderEntry.innerHTML =
            priceInput('open') + '<input id="unitAmount-open" value="">' +
            '<button type="button">开多</button><button type="button">开空</button>' +
            '<div data-testid="max-buy-amount">可开 ' + state.openableQuantity + ' HYPE</div>' +
            '<div data-testid="max-sell-amount">可开 ' + state.openableQuantity + ' HYPE</div>';
        } else {
          orderEntry.innerHTML =
            priceInput('close') + '<input id="unitAmount-close" value="">' +
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
            const submitSymbol = scenario.currentSymbol;
            const action = button.textContent.trim();
            const price = orderEntry.querySelector('input[id^="limitPrice-"]')?.value || '';
            const quantity = orderEntry.querySelector('input[id^="unitAmount-"]')?.value || '';
            const clientOrderId = 'web_fixture_' + submitSequence;
            record('order-submitted', { submitSequence, action, price, quantity, orderType: state.orderType, clientOrderId });
            // Mirrors the observed native body; hedge mode closes a long with SELL + positionSide LONG.
            const requestBody = {
              symbol: scenario.currentSymbol,
              type: state.orderType === 'MARKET' ? 'MARKET' : 'LIMIT',
              side: ['开多', '平空'].includes(action) ? 'BUY' : 'SELL',
              positionSide: ['开多', '平多'].includes(action) ? 'LONG' : 'SHORT',
              quantity: Number(quantity),
              ...(state.orderType === 'MARKET' ? {} : { price, timeInForce: 'GTX' }),
              newClientOrderId: clientOrderId,
              placeType: 'order-form',
              submitSequence,
              ...scenario.host.placeOrderBodyOverrides,
            };
            const showFeedback = (outcome) => {
              const feedback = document.createElement('div');
              feedback.setAttribute('role', 'alert');
              feedback.textContent = outcome === 'success' ? '订单已提交成功' : '订单提交失败';
              document.body.append(feedback);
              record('order-submit-feedback', { action: button.textContent.trim(), submitSequence, outcome });
            };
            window.fetch('/bapi/futures/v1/private/future/order/place-order', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(requestBody),
            }).catch((error) => {
              record('order-submit-request-failed', { submitSequence, message: error.message });
              return null;
            }).then(async (response) => {
              if (!response) return;
              const payload = await response.json();
              const outcome = response.ok && payload.success === true ? 'success'
                : payload.success === false ? 'rejected' : 'unknown';
              record('order-submit-api-' + outcome, { submitSequence, code: payload.code });
              if (outcome === 'success') publishSubmittedChartOrder(submitSequence, submitSymbol);
              if (outcome === 'unknown') return;
              if (scenario.host.submitFeedbackDelayMs > 0) {
                setTimeout(() => showFeedback(outcome), scenario.host.submitFeedbackDelayMs);
              } else {
                showFeedback(outcome);
              }
            });
          });
        });
        orderEntry.querySelectorAll('input').forEach((input) => {
          input.addEventListener('input', () => {
            record('trade-input-written', { id: input.id, value: input.value });
          });
        });
      }

      let precisionControlSequence = 0;
      let precisionControl;

      /**
       * The native Select keeps its portal ID in Dropdown.overlay on both owner
       * branches; its custom field does not expose an aria-controls shortcut.
       */
      function bindPrecisionControl(root) {
        const select = root.querySelector('.bn-select');
        const trigger = select.querySelector('.bn-select-trigger');
        const listboxId = 'bn-select-fixture-precision-' + (++precisionControlSequence);
        const ownerBranch = () => ({
          stateNode: select,
          return: {
            memoizedProps: { overlay: { props: { id: listboxId } } },
            return: { stateNode: root, return: null },
          },
        });
        const fiber = ownerBranch();
        fiber.alternate = ownerBranch();
        select.__reactFiber$fixture = fiber;
        const control = {
          root,
          select,
          listboxId,
          symbol: scenario.currentSymbol,
          options: [...scenario.host.precisionOptions],
          bubble: null,
        };
        trigger.addEventListener('click', () => renderPrecisionOverlay(control));
        return control;
      }

      function closePrecisionOverlay(control) {
        control.bubble.remove();
        control.bubble = null;
        control.select.classList.remove('active');
        record('precision-overlay-closed', { symbol: control.symbol, listboxId: control.listboxId });
      }

      function renderPrecisionOverlay(control) {
        if (control.select.classList.contains('active')) {
          closePrecisionOverlay(control);
          return;
        }
        const bubble = document.createElement('div');
        bubble.className = 'bn-bubble bn-tooltips active bn-select-bubble';
        const rect = control.select.getBoundingClientRect();
        bubble.style.top = rect.bottom + 'px';
        bubble.style.left = rect.left + 'px';
        bubble.innerHTML = '<div class="bn-bubble-content"><div class="bn-select-overlay">' +
          '<div class="bn-select-overlay-options" role="listbox" id="' + control.listboxId + '">' +
          control.options.map((value) => (
            '<div class="bn-select-option" role="option" aria-selected="' + selected(value, state.orderbookPrecision) +
            '" data-precision-value="' + value + '"><span>' + value + '</span></div>'
          )).join('') + '</div></div></div>';
        control.bubble = bubble;
        document.body.append(bubble);
        control.select.classList.add('active');
        record('precision-overlay-opened', { symbol: control.symbol, listboxId: control.listboxId });
        bubble.querySelectorAll('[data-precision-value]').forEach((option) => {
          option.addEventListener('click', () => {
            state.orderbookPrecision = option.dataset.precisionValue;
            control.root.querySelector('.tick-content').textContent = state.orderbookPrecision;
            record('precision-selected', {
              value: state.orderbookPrecision,
              symbol: control.symbol,
              listboxId: control.listboxId,
            });
            closePrecisionOverlay(control);
          });
        });
      }

      function replacePrecisionControl({ scope, symbol, value, options }) {
        if (!['select', 'root'].includes(scope)) throw new Error('Unsupported precision replacement scope');
        if (!options.includes(value)) throw new Error('Replacement precision must be a native option');
        const previousControl = precisionControl;
        if (previousControl.bubble) closePrecisionOverlay(previousControl);
        scenario.host.precisionOptions = [...options];
        state.orderbookPrecision = value;
        const root = scope === 'root' ? previousControl.root.cloneNode(true) : previousControl.root;
        if (scope === 'select') {
          previousControl.select.replaceWith(previousControl.select.cloneNode(true));
        } else {
          previousControl.root.replaceWith(root);
        }
        root.querySelector('.tick-content').textContent = value;
        if (scenario.currentSymbol !== symbol) {
          scenario.currentSymbol = symbol;
          history.pushState({}, '', '/zh-CN/futures/' + symbol);
        }
        precisionControl = bindPrecisionControl(root);
        record('precision-control-replaced', { scope, symbol, listboxId: precisionControl.listboxId });
        return { previousListboxId: previousControl.listboxId, listboxId: precisionControl.listboxId };
      }

      localStorage.setItem('jh_binance_orderbook_precision_samples_v3:' + scenario.currentSymbol, '["81.0","81.01","81.02","81.03","81.04","81.05"]');

      function renderOrdersRows() {
        const allOrders = visibleOrders();
        const orders = loadedOrderCount === null ? allOrders : allOrders.slice(0, loadedOrderCount);
        if (!orders.length) return '<div data-empty-orders>暂无当前委托。</div>';
        return orders.map((item) => '<div class="open-order-row" data-order-id="' + item.id + '">' +
          '<span>2026-09-12 10:27:51</span>' +
          '<span>' + item.symbol + ' 永续</span> <span>限价</span> <span>' + item.side + '</span> ' +
          '<span>' + item.price + '</span> <span>' + item.quantity + '</span> ' +
          '<span>0</span> <span>只做Maker</span> <span>--</span> <span>--</span> <span>--</span>' +
          '<span><svg aria-label="撤销挂单" width="16" height="16" viewBox="0 0 16 16"><path d="M4 4L12 12M4 12L12 4" stroke="currentColor"/></svg></span>' +
          '</div>').join('');
      }

      function renderAccountWidget() {
        const positionCount = state.positions.length;
        const orderCount = state.orders.length;
        const basicCount = state.orders.filter((order) => order.kind === 'basic').length;
        const conditionalCount = state.orders.filter((order) => order.kind === 'conditional').length;
        accountWidget.innerHTML =
          '<div id="account-tabs">' +
            '<div role="tab" data-account-tab="positions" aria-selected="' + selected(state.accountTab, 'positions') + '">仓位(' + positionCount + ')</div>' +
            '<div role="tab" data-account-tab="openOrders" aria-selected="' + selected(state.accountTab, 'openOrders') + '">当前委托(' + orderCount + ')</div>' +
            '<div role="tab" data-account-tab="history" aria-selected="' + selected(state.accountTab, 'history') + '">历史委托</div>' +
          '</div>' +
          '<div id="OPEN_ORDERS" style="display:' + (state.accountTab === 'openOrders' ? 'block' : 'none') + '">' +
            '<div class="sub-tabs">' +
              '<div role="tab" data-open-orders-sub-tab="basic" aria-selected="' + selected(state.openOrdersSubTab, 'basic') + '">基础单(' + basicCount + ')</div>' +
              '<div role="tab" data-open-orders-sub-tab="conditional" aria-selected="' + selected(state.openOrdersSubTab, 'conditional') + '">条件委托(' + conditionalCount + ')</div>' +
            '</div>' +
            '<div role="checkbox" name="hideOtherSymbol" aria-checked="' + state.hideOtherSymbols + '">隐藏其他合约</div>' +
            '<div class="orders-content"' + (scenario.host.orderRowsPageSize === null ? ' style="overflow-y:auto"' : ' style="height:96px;overflow-y:auto"') + '>' +
              (scenario.host.orderRowsMountDelayMs === 0 ? renderOrdersRows() : '<div data-orders-loading>Loading orders</div>') + '</div>' +
            (visibleOrders().length ? '<button class="bn-button bn-button__text bn-button__text__yellow data-size-tiny" data-cancel-all>全撤</button>' : '') +
          '</div>';

        accountWidget.querySelectorAll('[data-account-tab]').forEach((tab) => {
          tab.addEventListener('click', () => scheduleCommit(() => {
            state.accountTab = tab.dataset.accountTab;
            loadedOrderCount = scenario.host.orderRowsPageSize;
            record('account-tab', { value: state.accountTab });
            renderAccountWidget();
          }));
        });
        accountWidget.querySelectorAll('[data-open-orders-sub-tab]').forEach((tab) => {
          tab.addEventListener('click', () => scheduleCommit(() => {
            state.openOrdersSubTab = tab.dataset.openOrdersSubTab;
            loadedOrderCount = scenario.host.orderRowsPageSize;
            record('open-orders-sub-tab', { value: state.openOrdersSubTab });
            renderAccountWidget();
          }));
        });
        accountWidget.querySelector('[name="hideOtherSymbol"]')?.addEventListener('click', () => scheduleCommit(() => {
          state.hideOtherSymbols = !state.hideOtherSymbols;
          loadedOrderCount = scenario.host.orderRowsPageSize;
          record('hide-other-symbols', { value: state.hideOtherSymbols });
          renderAccountWidget();
        }));
        accountWidget.querySelector('[data-cancel-all]')?.addEventListener('click', openCancelDialog);
        const content = accountWidget.querySelector('.orders-content');
        if (scenario.host.orderRowsMountDelayMs > 0) {
          commitOrderWindow(content);
          setTimeout(() => {
            if (!content.isConnected) return;
            content.innerHTML = renderOrdersRows();
            bindRowCancellation(content);
            record('order-rows-mounted', { ids: Array.from(content.querySelectorAll('[data-order-id]'), row => row.dataset.orderId) });
          }, scenario.host.orderRowsMountDelayMs);
        } else bindRowCancellation(content);
        if (scenario.host.orderRowsPageSize !== null) {
          content.addEventListener('scroll', () => {
            if (content.scrollTop + content.clientHeight < content.scrollHeight - 2) return;
            if (loadedOrderCount >= visibleOrders().length) return;
            loadedOrderCount += scenario.host.orderRowsPageSize;
            content.innerHTML = renderOrdersRows();
            bindRowCancellation(content);
            record('order-rows-page-loaded', { ids: Array.from(content.querySelectorAll('[data-order-id]'), row => row.dataset.orderId) });
          });
        }
      }

      /** The fixture renders DOM directly; this component is its stable React element-type identity. */
      function NativeOrderRow() { return null; }

      /** Event caches stay on the mounted hosts while React commits child-only updates to the current Fiber tree. */
      function commitOrderWindow(content) {
        const data = visibleOrders();
        const renderItem = item => ({ type: NativeOrderRow, key: String(item.id), props: { ...item } });
        const emptyState = { type: 'div', key: null, props: {} };
        const loading = Boolean(content.querySelector('[data-orders-loading]'));
        const list = { props: { data, renderItem, loading, emptyState, conRef: { current: content } } };
        const window = loadedOrderCount === null ? data : data.slice(0, loadedOrderCount);
        const elements = window.map(renderItem);
        const parentProps = { children: [null, null, { props: { children: list } }] };
        const contentProps = { children: [null, loading ? null : data.length
          ? { props: { children: [null, elements, null] } } : emptyState] };
        const previous = content.__reactFiber$fixture;
        const makeFiber = (tag, stateNode, memoizedProps) => ({
          tag, stateNode, memoizedProps, elementType: null, key: null,
          flags: 0, child: null, sibling: null, return: null, alternate: null,
        });
        let root;
        if (previous) {
          const oldRoot = previous.return.return.return.stateNode.current;
          root = oldRoot.alternate;
          if (!root) {
            root = makeFiber(3, oldRoot.stateNode, null);
            const parent = makeFiber(5, content.parentElement, null);
            const owner = makeFiber(0, null, null);
            const host = makeFiber(5, content, null);
            const next = [root, parent, owner, host];
            const old = [oldRoot, oldRoot.child, oldRoot.child.child, oldRoot.child.child.child];
            next.forEach((fiber, index) => {
              fiber.alternate = old[index];
              old[index].alternate = fiber;
              if (index) {
                fiber.return = next[index - 1];
                next[index - 1].child = fiber;
              }
            });
          }
        } else {
          root = makeFiber(3, { current: null }, null);
          const parent = makeFiber(5, content.parentElement, null);
          const owner = makeFiber(0, null, null);
          const host = makeFiber(5, content, null);
          root.child = parent;
          parent.return = root;
          parent.child = owner;
          owner.return = parent;
          owner.child = host;
          host.return = owner;
          content.parentElement.__reactFiber$fixture = parent;
          content.__reactFiber$fixture = host;
          content.parentElement.__reactProps$fixture = parentProps;
          content.__reactProps$fixture = contentProps;
        }
        const host = root.child.child.child;
        root.child.memoizedProps = parentProps;
        root.child.child.memoizedProps = list.props;
        host.memoizedProps = contentProps;
        host.child = null;
        if (!loading && !data.length) {
          const empty = makeFiber(5, content.querySelector('[data-empty-orders]'), emptyState.props);
          empty.elementType = emptyState.type;
          empty.key = emptyState.key;
          empty.return = host;
          host.child = empty;
        }
        let previousRow = null;
        content.querySelectorAll('.open-order-row').forEach((row, index) => {
          const order = window[index];
          const element = makeFiber(0, null, elements[index].props);
          element.elementType = elements[index].type;
          element.key = elements[index].key;
          const { symbol, orderId, clientOrderId } = order;
          const identity = makeFiber(0, null, { symbol, orderId, clientOrderId,
            origQty: order.quantity, executedQty: order.executedQty ?? 0 });
          const rowHost = makeFiber(5, row, null);
          element.return = host;
          element.child = identity;
          identity.return = element;
          identity.child = rowHost;
          rowHost.return = identity;
          row.__reactFiber$fixture = rowHost;
          if (previousRow) previousRow.sibling = element;
          else host.child = element;
          previousRow = element;
        });
        root.stateNode.current = root;
      }

      function bindRowCancellation(content) {
        commitOrderWindow(content);
        content.querySelectorAll('.open-order-row').forEach((row) => {
          row.querySelector('svg[aria-label="撤销挂单"]').addEventListener('click', () => {
            const orderId = row.dataset.orderId;
            record('row-cancel-requested', { orderId });
            const mode = scenario.host.rowCancelModesById[orderId] ?? scenario.host.rowCancelMode;
            if (mode === 'unchanged') return;
            if (mode === 'dialog') openRowCancelDialog(orderId);
            else requestRowCancellation(orderId);
          });
        });
      }

      function requestRowCancellation(id) {
        const order = state.orders.find(item => item.id === id);
        if (!('orderId' in order)) {
          clearNativeOrder(id);
          return;
        }
        const { symbol, orderId, clientOrderId } = order;
        fetch('/bapi/futures/v1/private/future/order/cancel-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, orderId, clientOrderId }),
        }).then(async response => {
          const payload = await response.json();
          record('row-cancel-response', { orderId: id, httpStatus: response.status, payload });
          if (response.status === 200 && payload.success === true && payload.code === '000000'
            && payload.data?.status === 'CANCELED' && payload.data.orderId === orderId
            && payload.data.clientOrderId === clientOrderId && (payload.data.symbol === undefined || payload.data.symbol === symbol)
            && state.orders.some(item => item.id === id)) clearNativeOrder(id);
        });
      }

      /** A row action removes only its captured native ID, even for an unsafe caller. */
      function clearNativeOrder(orderId) {
        setTimeout(() => {
          const removed = state.orders.filter(order => order.id === orderId);
          if (removed.length !== 1) throw new Error('Row cancellation requires one existing native order');
          state.orders = state.orders.filter(order => order.id !== orderId);
          if (scenario.host.openableQuantityAfterRowCancel !== null) {
            state.openableQuantity = scenario.host.openableQuantityAfterRowCancel;
            if (state.tradeMode === 'OPEN') {
              document.querySelectorAll('.order-entry [data-testid^="max-"]').forEach(element => {
                element.textContent = '可开 ' + state.openableQuantity + ' HYPE';
              });
            }
          }
          scheduleChartOrderRemovals(removed);
          record('row-cancel-cleared', { orderId });
          renderAccountWidget();
        }, scenario.host.rowCancelDelayMs);
      }

      function openRowCancelDialog(orderId) {
        if (state.dialogOpen) throw new Error('Fixture opened a duplicate row cancellation dialog');
        state.dialogOpen = true;
        record('row-dialog-opened', { orderId });
        const root = document.createElement('div');
        root.className = 'bn-modal-root';
        root.innerHTML = '<div role="dialog"><div class="bn-modal-title">取消此委托？</div>' +
          '<button type="button" data-row-dialog-action="cancel">取消</button>' +
          '<button type="button" class="bn-button bn-button__primary" data-row-dialog-action="confirm">确认</button></div>';
        root.querySelector('[data-row-dialog-action="cancel"]').addEventListener('click', () => closeDialog('row-cancel'));
        root.querySelector('[data-row-dialog-action="confirm"]').addEventListener('click', () => {
          closeDialog('row-confirm');
          requestRowCancellation(orderId);
        });
        document.body.append(root);
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

      function attachDialogHandlers(root, scope) {
        root.addEventListener('click', (event) => {
          if (event.target === root) closeDialog('backdrop');
        });
        root.querySelector('[data-dialog-action="cancel"]').addEventListener('click', () => closeDialog('cancel'));
        root.querySelector('[data-dialog-action="confirm"]').addEventListener('click', () => {
          record('cancel-requested', { ...scope });
          setTimeout(() => {
            if (scenario.host.clearMode === 'capturedScope') {
              const removedOrders = state.orders.filter((item) => scope.orderIds.includes(item.id));
              state.orders = state.orders.filter((item) => !scope.orderIds.includes(item.id));
              scheduleChartOrderRemovals(removedOrders);
              record('cancel-cleared', { ...scope, orderIds: removedOrders.map((item) => item.id) });
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
        /** The host honors the initiating UI scope, including an unsafe unfiltered request. */
        const scope = Object.freeze({
          symbol: scenario.currentSymbol,
          accountTab: state.accountTab,
          openOrdersSubTab: state.openOrdersSubTab,
          hideOtherSymbols: state.hideOtherSymbols,
          orderIds: Object.freeze(visibleOrders().map((item) => item.id)),
        });
        state.dialogOpen = true;
        record('dialog-opened', { scope });
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
        attachDialogHandlers(root, scope);
        if (scenario.host.dialogReplacementDelayMs !== null) {
          setTimeout(() => {
            if (!state.dialogOpen || !root.isConnected) return;
            const replacement = root.cloneNode(true);
            root.replaceWith(replacement);
            attachDialogHandlers(replacement, scope);
            record('dialog-replaced');
          }, scenario.host.dialogReplacementDelayMs);
        }
      }

      const chartOrdersPopover = document.querySelector('#chart-orders-menu');
      const chartOrdersTrigger = document.querySelector('[data-testid="chart-orders-trigger"]');
      const chartRoot = document.querySelector('.chart-widget-root');
      const chartEventListeners = new Map();
      const chartOrderDrawings = new Map((state.showOrders ? currentOrders() : []).map(order => [
        'order-' + order.id,
        { toolname: 'LineToolOrder', symbol: order.symbol },
      ]));
      function readChartSnapshot() {
        return { checked: state.showOrders, drawingIds: [...chartOrderDrawings.keys()] };
      }
      const tradingViewApi = {
        saveChart(callback, options) {
          if (typeof callback !== 'function') throw new TypeError('Native chart save requires a callback');
          const snapshot = options?.includeDrawings === false
            ? { checked: state.showOrders, drawingIds: [] }
            : readChartSnapshot();
          record('chart-serialized', { snapshot: JSON.parse(JSON.stringify(snapshot)) });
          return callback(snapshot);
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
      if (scenario.host.orderDrawingEvents) {
        tradingViewApi.activeChart = () => ({
          getShapeById(drawingId) {
            const drawing = chartOrderDrawings.get(drawingId);
            if (!drawing) throw new Error('No native chart order drawing exists for ' + drawingId);
            return { lineDataSource: () => drawing };
          },
        });
      }

      let chartSaveRequestSequence = 0;
      function requestChartSave(details) {
        const requestId = ++chartSaveRequestSequence;
        record('chart-save-requested', { ...details, requestId, snapshot: readChartSnapshot() });
        tradingViewApi.saveChart(snapshot => record('chart-saved', { requestId, snapshot }));
      }

      /** Native broker events request a complete chart serialization 100 ms later. */
      function publishNativeOrderDrawingEvent(drawingId, eventType) {
        record('chart-drawing-event', { drawingId, eventType, toolname: 'LineToolOrder' });
        tradingViewApi.emit('drawing_event', drawingId, eventType);
        setTimeout(() => {
          requestChartSave({ drawingId, eventType });
        }, 100);
      }

      function publishSubmittedChartOrder(submitSequence, submitSymbol) {
        if (!scenario.host.orderDrawingEvents || !state.showOrders || submitSymbol !== scenario.currentSymbol) return;
        const drawingId = 'order-submitted-' + submitSequence;
        if (chartOrderDrawings.has(drawingId)) throw new Error('A native submitted drawing cannot be created twice');
        chartOrderDrawings.set(drawingId, { toolname: 'LineToolOrder', symbol: submitSymbol });
        publishNativeOrderDrawingEvent(drawingId, 'create');
      }

      function scheduleChartOrderRemovals(orders) {
        if (!state.showOrders) return;
        orders.forEach((order, index) => {
          setTimeout(() => {
            const drawingId = 'order-' + order.id;
            // Off-chart order cancellations have no visible drawing to remove.
            if (!chartOrderDrawings.delete(drawingId)) return;
            if (scenario.host.orderDrawingEvents) {
              publishNativeOrderDrawingEvent(drawingId, 'remove');
              return;
            }
            tradingViewApi.emit('drawing_event', 'order-' + order.id, 'remove');
            requestChartSave({ checked: true, index, orderId: order.id });
          }, scenario.host.mutationDelayMs + (index * 2));
        });
      }

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
              const drawingId = 'order-' + order.id;
              if (nextChecked) chartOrderDrawings.set(drawingId, { toolname: 'LineToolOrder', symbol: order.symbol });
              else chartOrderDrawings.delete(drawingId);
              tradingViewApi.emit(
                'drawing_event',
                'order-' + order.id,
                nextChecked ? 'properties_changed' : 'remove',
              );
              requestChartSave({ checked: nextChecked, index, orderId: order.id });
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
        replacePrecisionControl,
        /** Native account publications update counters without replacing their observer root. */
        setPositions(positions) {
          if (!Array.isArray(positions)) throw new Error('Native positions must be an array');
          state.positions = positions.map(position => ({ ...position }));
          accountWidget.querySelector('[data-account-tab="positions"]').textContent = '仓位(' + state.positions.length + ')';
          if (state.tradeMode === 'CLOSE') {
            document.querySelector('[data-testid="max-sell-amount"]').textContent = '可平 ' + currentPositionQuantity('LONG') + ' HYPE';
            document.querySelector('[data-testid="max-buy-amount"]').textContent = '可平 ' + currentPositionQuantity('SHORT') + ' HYPE';
          }
          record('native-positions-updated', { count: state.positions.length });
        },
        setOrders(orders) {
          if (!Array.isArray(orders) || orders.some(order => !['basic', 'conditional'].includes(order.kind))) {
            throw new Error('Native orders must be an array with explicit order kinds');
          }
          state.orders = orders.map(order => ({ ...order }));
          loadedOrderCount = scenario.host.orderRowsPageSize;
          accountWidget.querySelector('[data-account-tab="openOrders"]').textContent = '当前委托(' + state.orders.length + ')';
          accountWidget.querySelector('[data-open-orders-sub-tab="basic"]').textContent =
            '基础单(' + state.orders.filter(order => order.kind === 'basic').length + ')';
          accountWidget.querySelector('[data-open-orders-sub-tab="conditional"]').textContent =
            '条件委托(' + state.orders.filter(order => order.kind === 'conditional').length + ')';
          const content = accountWidget.querySelector('.orders-content');
          content.innerHTML = renderOrdersRows();
          bindRowCancellation(content);
          const cancelAll = accountWidget.querySelector('[data-cancel-all]');
          if (!visibleOrders().length && cancelAll) cancelAll.remove();
          if (visibleOrders().length && !cancelAll) {
            const button = document.createElement('button');
            button.className = 'bn-button bn-button__text bn-button__text__yellow data-size-tiny';
            button.type = 'button';
            button.setAttribute('data-cancel-all', '');
            button.textContent = '全撤';
            button.addEventListener('click', openCancelDialog);
            content.after(button);
          }
          record('native-orders-updated', { count: state.orders.length });
        },
        switchSymbol(symbol) {
          if (typeof symbol !== 'string' || !symbol) throw new Error('A symbol is required');
          scenario.currentSymbol = symbol;
          loadedOrderCount = scenario.host.orderRowsPageSize;
          history.pushState({}, '', '/zh-CN/futures/' + symbol);
          renderTradeMode();
          renderAccountWidget();
          record('symbol-changed', { symbol });
        },
        snapshot: () => JSON.parse(JSON.stringify({
          currentSymbol: scenario.currentSymbol,
          positions: state.positions,
          orders: state.orders,
          accountTab: state.accountTab,
          openOrdersSubTab: state.openOrdersSubTab,
          hideOtherSymbols: state.hideOtherSymbols,
          showOrders: state.showOrders,
          tradeMode: state.tradeMode,
          orderbookPrecision: state.orderbookPrecision,
          leverage: state.leverage,
          openableQuantity: state.openableQuantity,
          orderType: state.orderType,
          dialogOpen: state.dialogOpen,
          events: state.events,
        })),
      };
      document.querySelector('.tick-content').textContent = state.orderbookPrecision;
      document.querySelector('.quick-controls button:nth-child(2)').textContent = state.leverage + 'x';
      precisionControl = bindPrecisionControl(document.querySelector('#futuresOrderbook .orderbook-tickSize'));
      renderOrderTypeTabs();
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
