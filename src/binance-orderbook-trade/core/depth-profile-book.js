export class DepthProfileSequenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DepthProfileSequenceError';
  }
}

const MAX_BUFFERED_UPDATES = 500;

function assertSymbol(value) {
  if (typeof value !== 'string' || !/^[A-Z0-9_]+$/.test(value)) {
    throw new Error('Invalid depth profile symbol');
  }
  return value;
}

function assertUpdateId(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid depth profile ${field}`);
  }
  return value;
}

function parseLevels(value, field) {
  if (!Array.isArray(value)) throw new Error(`Invalid depth profile ${field}`);
  return value.map((level) => {
    if (!Array.isArray(level) || level.length < 2) {
      throw new Error(`Invalid depth profile ${field} level`);
    }
    const price = String(level[0]);
    const quantity = String(level[1]);
    const numericPrice = Number(price);
    const numericQuantity = Number(quantity);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      throw new Error(`Invalid depth profile ${field} price`);
    }
    if (!Number.isFinite(numericQuantity) || numericQuantity < 0) {
      throw new Error(`Invalid depth profile ${field} quantity`);
    }
    return [price, quantity];
  });
}

function parseSnapshot(payload, symbol) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid depth profile snapshot');
  }
  return {
    lastUpdateId: assertUpdateId(payload.lastUpdateId, 'snapshot update id'),
    bids: parseLevels(payload.bids, 'snapshot bids'),
    asks: parseLevels(payload.asks, 'snapshot asks'),
    symbol: assertSymbol(symbol),
  };
}

function parseUpdate(payload, symbol) {
  if (!payload || typeof payload !== 'object' || payload.e !== 'depthUpdate') {
    throw new Error('Invalid depth profile update');
  }
  if (payload.s !== symbol) {
    throw new Error(`Depth profile symbol mismatch: expected ${symbol}, received ${payload.s}`);
  }
  if (payload.st !== undefined && payload.st !== 1) {
    throw new Error(`Depth profile received non-USD-M data: ${payload.st}`);
  }
  return {
    firstUpdateId: assertUpdateId(payload.U, 'first update id'),
    finalUpdateId: assertUpdateId(payload.u, 'final update id'),
    previousFinalUpdateId: assertUpdateId(payload.pu, 'previous final update id'),
    bids: parseLevels(payload.b, 'bid updates'),
    asks: parseLevels(payload.a, 'ask updates'),
  };
}

function replaceLevels(target, levels) {
  target.clear();
  for (const [price, quantity] of levels) {
    if (Number(quantity) > 0) target.set(price, quantity);
  }
}

function applyLevels(target, levels) {
  for (const [price, quantity] of levels) {
    if (Number(quantity) === 0) target.delete(price);
    else target.set(price, quantity);
  }
}

function applyUpdate(book, update, { first = false } = {}) {
  if (!first && update.finalUpdateId <= book.previousFinalUpdateId) return;
  if (!first && update.previousFinalUpdateId !== book.previousFinalUpdateId) {
    throw new DepthProfileSequenceError(
      `Depth update sequence gap: expected pu ${book.previousFinalUpdateId}, received ${update.previousFinalUpdateId}`,
    );
  }
  applyLevels(book.bids, update.bids);
  applyLevels(book.asks, update.asks);
  book.previousFinalUpdateId = update.finalUpdateId;
  book.ready = true;
}

export function createDepthProfileBook(symbol) {
  return {
    symbol: assertSymbol(symbol),
    bids: new Map(),
    asks: new Map(),
    bufferedUpdates: [],
    snapshotUpdateId: null,
    previousFinalUpdateId: null,
    ready: false,
  };
}

export function pushDepthProfileUpdate(book, payload) {
  const update = parseUpdate(payload, book.symbol);
  if (book.snapshotUpdateId === null || !book.ready) {
    book.bufferedUpdates.push(update);
    if (book.bufferedUpdates.length > MAX_BUFFERED_UPDATES) {
      throw new DepthProfileSequenceError('Depth update buffer exceeded its limit');
    }
    if (book.snapshotUpdateId !== null) applyBufferedUpdates(book);
    return book.ready;
  }
  applyUpdate(book, update);
  return true;
}

function applyBufferedUpdates(book) {
  const eligibleUpdates = book.bufferedUpdates.filter(
    (update) => update.finalUpdateId >= book.snapshotUpdateId,
  );
  if (!eligibleUpdates.length) {
    book.bufferedUpdates = [];
    return false;
  }

  const firstIndex = eligibleUpdates.findIndex(
    (update) => (
      update.firstUpdateId <= book.snapshotUpdateId
      && update.finalUpdateId >= book.snapshotUpdateId
    ),
  );
  if (firstIndex < 0) {
    const first = eligibleUpdates[0];
    if (first.firstUpdateId > book.snapshotUpdateId) {
      throw new DepthProfileSequenceError(
        `Depth snapshot gap: snapshot ${book.snapshotUpdateId}, first update ${first.firstUpdateId}`,
      );
    }
    book.bufferedUpdates = eligibleUpdates;
    return false;
  }

  const updates = eligibleUpdates.slice(firstIndex);
  applyUpdate(book, updates[0], { first: true });
  for (const update of updates.slice(1)) applyUpdate(book, update);
  book.bufferedUpdates = [];
  return true;
}

export function applyDepthProfileSnapshot(book, payload) {
  const snapshot = parseSnapshot(payload, book.symbol);
  replaceLevels(book.bids, snapshot.bids);
  replaceLevels(book.asks, snapshot.asks);
  book.snapshotUpdateId = snapshot.lastUpdateId;
  book.previousFinalUpdateId = null;
  book.ready = false;
  return applyBufferedUpdates(book);
}

function toSortedLevels(levels, direction) {
  return [...levels.entries()]
    .map(([price, quantity]) => ({
      price: Number(price),
      quantity: Number(quantity),
    }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.quantity))
    .sort((left, right) => direction * (left.price - right.price));
}

function addCumulativeQuantity(levels) {
  let cumulative = 0;
  return levels.map((level) => {
    cumulative += level.quantity;
    return { ...level, cumulative };
  });
}

export function buildDepthProfile(book) {
  if (!book.ready) throw new Error('Depth profile book is not ready');
  const bids = addCumulativeQuantity(toSortedLevels(book.bids, -1));
  const asks = addCumulativeQuantity(toSortedLevels(book.asks, 1));
  if (!bids.length || !asks.length) throw new Error('Depth profile requires bids and asks');

  const midPrice = (bids[0].price + asks[0].price) / 2;
  const furthestDistance = Math.max(
    midPrice - bids[bids.length - 1].price,
    asks[asks.length - 1].price - midPrice,
  );
  if (!(furthestDistance > 0)) throw new Error('Depth profile price range is empty');
  const maxCumulative = Math.max(
    bids[bids.length - 1].cumulative,
    asks[asks.length - 1].cumulative,
  );
  if (!(maxCumulative > 0)) throw new Error('Depth profile quantity range is empty');

  return {
    symbol: book.symbol,
    midPrice,
    minPrice: midPrice - furthestDistance,
    maxPrice: midPrice + furthestDistance,
    maxCumulative,
    bids,
    asks,
  };
}
