import { replaceOrderNotificationFactory } from './native-modules.js';
import { createOrderNotificationToken, isOrderNotificationTokenAllowed } from './scope.js';

const MODULE_IDS = ['30877', '39116', '55401'];

/**
 * Share the orderbook's single early queue observer without sharing storage
 * state. Producer and player must both execute their pinned factories before
 * either side changes the native string queue contract.
 */
export function createOrderNotificationScope() {
  const states = Object.fromEntries(MODULE_IDS.map(id => [id, {
    status: 'waiting', reason: null, attempts: 0, matches: 0,
  }]));
  let checks = 0;
  let suppressedChecks = 0;
  const soundReady = () => states['39116'].status === 'active' && states['55401'].status === 'active';

  function allowToken(token) {
    const allowed = isOrderNotificationTokenAllowed(token, self.location.pathname);
    checks += 1;
    if (!allowed) suppressedChecks += 1;
    return allowed;
  }

  const bridge = Object.freeze({
    token: createOrderNotificationToken,
    allowToken,
    allowOrder: order => allowToken(createOrderNotificationToken(order)),
    soundReady,
    soundInput: order => soundReady() ? createOrderNotificationToken(order) : String(order.orderId),
    allowSoundInput: token => !soundReady() || allowToken(token),
    canPlay: token => !soundReady() || allowToken(token),
    prepareSound(queue) {
      if (!soundReady()) return true;
      // Native j() runs only after its cooldown ends. Removing the in-flight
      // head sooner would make the scheduled pop delete the next notification.
      while (queue.current.length && !allowToken(queue.current[0])) queue.current.shift();
      return queue.current.length > 0;
    },
  });

  const targets = Object.fromEntries(MODULE_IDS.map(id => [id, {
    replace(original) {
      states[id].attempts += 1;
      const factory = replaceOrderNotificationFactory(id, original, bridge);
      states[id].matches += 1;
      return factory;
    },
    onCapture() { states[id].status = 'active'; },
    onFailure(reason) {
      states[id].status = reason === 'source_mismatch' ? 'source_mismatch' : 'unavailable';
      states[id].reason = reason;
    },
  }]));

  return Object.freeze({
    targets,
    snapshot() {
      return {
        toastActive: states['30877'].status === 'active', soundActive: soundReady(),
        checks, suppressedChecks,
        modules: Object.fromEntries(MODULE_IDS.map(id => [id, { ...states[id] }])),
      };
    },
  });
}
