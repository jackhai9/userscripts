/** All existing and new suites now follow the strict behavior policy. */
export const legacyBehaviorGroups = [];

export const legacyBehaviorFiles = legacyBehaviorGroups.flatMap((group) => group.files);

/** All previously allowed method replacements and fixed waits are migrated. */
export const legacyCallAllowances = [];

/** Host measurement needs one real task boundary after the observed interaction. */
export const contractCallAllowances = [
  {
    file: 'e2e/binance-orderbook/helpers/live-performance-probe.js',
    rule: 'no-fixed-waits',
    allow: [{
      target: 'window.setTimeout(0)',
      within: 'finishAfterPerformanceTail',
      count: 1,
      reason: 'PerformanceObserver entries arrive after the real host task. This single zero-delay boundary drains that performance tail before observer teardown; it is not a business wait or a virtual-clock measurement.',
    }],
  },
];
