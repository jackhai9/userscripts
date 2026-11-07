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

/** Only requests for armed native row clicks participate. Each response belongs to its own fetch promise. */
export function createNativeCancelReceipts(timeoutMs) {
  const tickets = new Map();
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
          ambiguous = true;
          admissionClosed = true;
          return;
        }
        ticket.hasStarted = true;
        timer = setTimeout(() => ticket.finish(false), timeoutMs);
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
      if (response.status !== 200) return false;
      const payload = await response.clone().json();
      const data = payload?.data;
      return payload?.success === true && payload.code === '000000' && data?.status === 'CANCELED'
        && (data.symbol === undefined || data.symbol === request.symbol)
        && exactOrderId(data.orderId) === exactOrderId(request.orderId)
        && data.clientOrderId === request.clientOrderId;
    }).then(ticket.receive, () => ticket.receive(false));
  }
  function observeOrderUpdate(order) {
    const ticket = tickets.get(exactOrderId(order?.i));
    ticket?.recordTerminal(order);
  }
  return { expect, observe, observeOrderUpdate, get admissionClosed() { return admissionClosed; } };
}
