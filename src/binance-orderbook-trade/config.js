/**
 * Target USDT allocation for automatic and manually confirmed account rebalancing,
 * in whole percentages that total 100. The panel shows the reduced ratio
 * (70/20/10 is 7:2:1); Futures keeps any 1e-8 USDT rounding remainder.
 */
export const USDT_REBALANCE_TARGET_PERCENTS = Object.freeze({
  FUNDING: 70,
  MAIN: 20,
  UMFUTURE: 10,
});
