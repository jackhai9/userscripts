const STATUS_QUOTE_ASSETS = Object.freeze(['USDT', 'USDC']);

export function formatStatusBaseAsset(symbol) {
  if (typeof symbol !== 'string') {
    throw new Error(`Unsupported futures status symbol: ${symbol}`);
  }
  const normalized = symbol.trim().toUpperCase();
  const quoteAsset = STATUS_QUOTE_ASSETS.find((candidate) => normalized.endsWith(candidate));
  const baseAsset = quoteAsset ? normalized.slice(0, -quoteAsset.length) : '';
  if (!baseAsset) {
    throw new Error(`Unsupported futures status symbol: ${symbol}`);
  }
  return baseAsset;
}
