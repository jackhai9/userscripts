export function isPotentialOrderFeedbackText(text) {
  if (!text) return false;
  return /订单|委托|下单|已提交|已下单|不足|拒绝|过期|order|placed|submitted|failed|rejected|error|insufficient|失败/i
    .test(text);
}

export function classifyOrderFeedback(text) {
  if (!text) return 'none';
  if (/失败|拒绝|错误|不足|过期|取消|failed|rejected|error|insufficient/i.test(text)) return 'failure';
  if (
    /已提交|已下单|委托已|order placed|submitted|placed/i.test(text) ||
    (/(订单|委托|下单|order)/i.test(text) && /成功|success/i.test(text))
  ) {
    return 'success';
  }
  return 'unknown';
}

export function evaluateOrderSubmitAcknowledgement({ feedback, isNewFeedback }) {
  if (!feedback || !isNewFeedback) return { status: 'pending' };

  const feedbackType = classifyOrderFeedback(feedback);
  if (feedbackType === 'failure') return { status: 'failure', message: feedback };
  if (feedbackType === 'success') return { status: 'success' };
  return { status: 'pending' };
}

export function isReduceOnlyOpenOrdersConflictFeedback(text) {
  if (!text) return false;
  const normalized = String(text).replace(/\s+/g, '');
  return (
    normalized.includes('只减仓订单失败') &&
    (
      normalized.includes('当前挂单') ||
      normalized.includes('挂单后重试') ||
      normalized.includes('未平仓头寸和挂单')
    )
  );
}

export function isOpenLadderOpenOrdersCapacityFeedback(text) {
  if (!text) return false;
  const normalized = String(text).replace(/\s+/g, '').toLowerCase();
  const hasCapacityFailure = (
    normalized.includes('余额不足') ||
    normalized.includes('可用余额不足') ||
    normalized.includes('可用数量不足') ||
    normalized.includes('可开数量不足') ||
    normalized.includes('可用保证金不足') ||
    normalized.includes('insufficientmargin') ||
    normalized.includes('insufficientbalance') ||
    normalized.includes('insufficientavailablebalance') ||
    normalized.includes('notenoughmargin') ||
    normalized.includes('notenoughbalance') ||
    normalized.includes('notenoughavailablebalance')
  );
  const hasOpenOrdersHint = (
    normalized.includes('当前挂单') ||
    normalized.includes('取消挂单') ||
    normalized.includes('挂单后重试') ||
    normalized.includes('openorders') ||
    normalized.includes('existingopenorders')
  );
  return hasCapacityFailure && hasOpenOrdersHint;
}

/**
 * Binance localizes and may revise GTX rejection messages, so retry only when
 * the three stable semantics all remain present instead of matching one phrase.
 */
export function isPostOnlyMakerRejectionFeedback(text) {
  if (!text) return false;
  const normalized = String(text).replace(/[\s-]+/g, '').toLowerCase();
  const hasPostOnlyOrder = (
    normalized.includes('postonly') ||
    normalized.includes('只做maker') ||
    normalized.includes('仅做maker')
  );
  const hasMakerExecutionConflict = (
    /(未|无法|不能|未能).{0,8}作为maker.{0,8}(执行|成交)/.test(normalized) ||
    /(couldnot|cannot|wasnot|isnot).{0,12}(executed|execute|filled|fill).{0,8}as(?:a)?maker/.test(normalized)
  );
  const hasRejection = /拒绝|驳回|reject/.test(normalized);
  return hasPostOnlyOrder && hasMakerExecutionConflict && hasRejection;
}

const BINANCE_POST_ONLY_MAKER_REJECT_CODES = new Set([-5022, 90805022]);

export function isBinancePostOnlyMakerRejectCode(code) {
  return BINANCE_POST_ONLY_MAKER_REJECT_CODES.has(code);
}

export function getBinanceApiErrorCode(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (Number.isSafeInteger(payload.code)) return payload.code === 0 ? null : payload.code;
  if (typeof payload.code !== 'string' || !/^-?\d+$/.test(payload.code)) return null;
  const code = Number(payload.code);
  return Number.isSafeInteger(code) && code !== 0 ? code : null;
}
