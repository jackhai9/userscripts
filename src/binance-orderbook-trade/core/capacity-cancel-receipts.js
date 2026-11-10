import { compareDecimalStrings, subtractDecimalStrings } from './decimal.js';

function exactOrderId(id) {
  if (Number.isSafeInteger(id) && id > 0) return String(id);
  return typeof id === 'string' && /^[1-9]\d*$/.test(id) ? id : null;
}

export function sameNativeOrder(target, order) {
  const id = exactOrderId(target.orderId);
  return typeof target.symbol === 'string' && target.symbol.length > 0
    && id !== null && id === exactOrderId(order?.orderId)
    && typeof target.clientOrderId === 'string' && target.clientOrderId.length > 0
    && target.clientOrderId === order.clientOrderId && target.symbol === order.symbol;
}

function isDecimalString(value) {
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
}

/**
 * Only requests for armed native row clicks participate. Each response belongs to its own fetch promise.
 * Full-fill account events are evidence for the batch: a cancellation that loses the race to a fill
 * cannot be confirmed, yet the exact FILLED frame proves the order left without being cancelled.
 * FILLED is terminal, so frames observed before the batch (priorFills) remain valid evidence.
 */
export function createNativeCancelReceipts(timeoutMs, priorFills = []) {
  const tickets = new Map();
  const fills = [...priorFills];
  const fillWaiters = new Set();
  let admissionClosed = false;

  function expect(target, quantity = null) {
    const key = exactOrderId(target.orderId);
    if (!sameNativeOrder(target, target) || tickets.has(key)) throw new Error('Invalid or duplicate cancellation identity');
    const started = Promise.withResolvers();
    const result = Promise.withResolvers();
    const released = quantity && Promise.withResolvers();
    let terminalQty;
    let httpConfirmed = false;
    let timer;
    let outstanding = 0;
    let ambiguous = false;
    const ticket = {
      target, started: started.promise, result: result.promise, released: released?.promise, hasStarted: false,
      /** Why the result is unconfirmed, for diagnostics only; the first observed reason wins. */
      failure: null,
      noteFailure(reason) {
        ticket.failure ??= reason;
      },
      recordTerminal(order) {
        if (!quantity || !ticket.hasStarted || order.x !== 'CANCELED' || order.X !== 'CANCELED') return;
        if (!sameNativeOrder(target, { symbol: order.s, orderId: order.i, clientOrderId: order.c })) return;
        const valid = [order.q, order.z].every(value => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))
          && compareDecimalStrings(order.q, quantity.origQty) === 0
          && [0, 1].includes(compareDecimalStrings(order.z, quantity.executedQty));
        const amount = valid ? subtractDecimalStrings(order.q, order.z) : null;
        // A repeated terminal frame is idempotent. Conflicting terminal quantities cannot authorize replacement.
        terminalQty = terminalQty === undefined || terminalQty === amount ? amount : null;
        if (httpConfirmed && !outstanding) ticket.finish(!ambiguous);
      },
      stopQuantityWait() {
        terminalQty = null;
        if (httpConfirmed && !outstanding) ticket.finish(!ambiguous);
      },
      finish(confirmed) {
        if (tickets.get(key) !== ticket) return;
        if (confirmed) httpConfirmed = true;
        result.resolve(confirmed);
        if (confirmed && released && terminalQty === undefined) return;
        if (!confirmed) admissionClosed = true;
        tickets.delete(key);
        clearTimeout(timer);
        released?.resolve(confirmed ? terminalQty : null);
      },
      start() {
        outstanding += 1;
        if (ticket.hasStarted) {
          // Multiple requests for one armed identity cannot be attributed to one click.
          ticket.noteFailure('multiple requests');
          ambiguous = true;
          admissionClosed = true;
          return;
        }
        ticket.hasStarted = true;
        timer = setTimeout(() => {
          ticket.noteFailure(httpConfirmed ? 'account event timeout' : 'response timeout');
          ticket.finish(false);
        }, timeoutMs);
        started.resolve();
      },
      receive(confirmed) {
        outstanding -= 1;
        if (!outstanding) ticket.finish(confirmed && !ambiguous);
      },
    };
    tickets.set(key, ticket);
    return ticket;
  }

  function observe(body, promise) {
    if (typeof body !== 'string') return;
    let request;
    try { request = JSON.parse(body); } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
    const ticket = tickets.get(exactOrderId(request?.orderId));
    if (!ticket || !sameNativeOrder(ticket.target, request)) return;
    ticket.start();
    // A transport or unreadable body has an unknown financial outcome. Never retry that click.
    promise.then(async response => {
      if (response.status !== 200) {
        ticket.noteFailure(`HTTP ${response.status}`);
        return false;
      }
      const payload = await response.clone().json();
      const data = payload?.data;
      const cancelled = payload?.success === true && payload.code === '000000' && data?.status === 'CANCELED';
      if (!cancelled) {
        ticket.noteFailure(`response code ${payload?.code} status ${data?.status}`);
        return false;
      }
      const sameIdentity = (data.symbol === undefined || data.symbol === request.symbol)
        && exactOrderId(data.orderId) === exactOrderId(request.orderId)
        && data.clientOrderId === request.clientOrderId;
      if (!sameIdentity) ticket.noteFailure('response for another order');
      return sameIdentity;
    }, error => {
      ticket.noteFailure(`no response ${error?.name}`);
      return false;
    }).then(ticket.receive, error => {
      ticket.noteFailure(`unreadable response ${error?.name}`);
      ticket.receive(false);
    });
  }
  function observeOrderUpdate(order) {
    const ticket = tickets.get(exactOrderId(order?.i));
    ticket?.recordTerminal(order);
    if (order?.x !== 'TRADE' || order.X !== 'FILLED') return;
    fills.push(order);
    for (const waiter of fillWaiters) waiter(order);
  }
  /**
   * Resolves once this batch observed the exact order filling its whole preflight quantity.
   * A partial fill, an amended quantity, or a foreign identity never resolves it.
   */
  function filled(target, quantity) {
    const matches = order => sameNativeOrder(target, { symbol: order.s, orderId: order.i, clientOrderId: order.c })
      && isDecimalString(order.q) && isDecimalString(order.z)
      && compareDecimalStrings(order.q, quantity.origQty) === 0 && compareDecimalStrings(order.z, order.q) === 0;
    if (fills.some(matches)) return Promise.resolve(true);
    return new Promise(resolve => {
      const waiter = order => {
        if (!matches(order)) return;
        fillWaiters.delete(waiter);
        resolve(true);
      };
      fillWaiters.add(waiter);
    });
  }
  return { expect, observe, observeOrderUpdate, filled, get admissionClosed() { return admissionClosed; } };
}
