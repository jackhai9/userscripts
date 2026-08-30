const STATUS_QUOTE_ASSETS = Object.freeze(['USDT', 'USDC']);

export function formatStatusBaseAsset(symbol) {
  if (typeof symbol !== 'string') {
    throw new Error(`不支持的合约状态交易对：${symbol}`);
  }
  const normalized = symbol.trim().toUpperCase();
  const quoteAsset = STATUS_QUOTE_ASSETS.find((candidate) => normalized.endsWith(candidate));
  const baseAsset = quoteAsset ? normalized.slice(0, -quoteAsset.length) : '';
  if (!baseAsset) {
    throw new Error(`不支持的合约状态交易对：${symbol}`);
  }
  return baseAsset;
}
