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
const BINANCE_MAX_OPEN_ORDERS_ERROR_CODE = 90802025;

export function isBinancePostOnlyMakerRejectCode(code) {
  return BINANCE_POST_ONLY_MAKER_REJECT_CODES.has(code);
}

export function isBinanceMaxOpenOrdersErrorCode(code) {
  return code === BINANCE_MAX_OPEN_ORDERS_ERROR_CODE;
}

export function getBinanceApiErrorCode(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (Number.isSafeInteger(payload.code)) return payload.code === 0 ? null : payload.code;
  if (typeof payload.code !== 'string' || !/^-?\d+$/.test(payload.code)) return null;
  const code = Number(payload.code);
  return Number.isSafeInteger(code) && code !== 0 ? code : null;
}

export function isBinancePlaceOrderSuccessPayload(payload) {
  return (
    payload != null
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && payload.success === true
    && getBinanceApiErrorCode(payload) == null
  );
}

function readDiagnosticScalar(value) {
  return ['string', 'number', 'boolean'].includes(typeof value) ? value : null;
}

function readDiagnosticMessage(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 160) : null;
}

/**
 * Keeps only response-contract evidence. Order identifiers and submitted values
 * remain inside `data` and are deliberately reduced to field names.
 */
export function summarizeBinancePlaceOrderPayload(payload) {
  const payloadType = Array.isArray(payload)
    ? 'array'
    : (payload === null ? 'null' : typeof payload);
  if (payloadType !== 'object') {
    return {
      payloadType,
      payloadKeys: [],
      dataKeys: [],
      success: null,
      code: null,
      message: null,
    };
  }

  const data = payload.data;
  return {
    payloadType,
    payloadKeys: Object.keys(payload).sort(),
    dataKeys: data && typeof data === 'object' && !Array.isArray(data)
      ? Object.keys(data).sort()
      : [],
    success: readDiagnosticScalar(payload.success),
    code: readDiagnosticScalar(payload.code),
    message: readDiagnosticMessage(payload.message ?? payload.msg),
  };
}

function formatRetryAfter(value) {
  if (value == null || value === '') return null;
  return /^\d+(?:\.\d+)?$/.test(String(value))
    ? `Retry-After ${value}s`
    : `Retry-After ${value}`;
}

export function formatBinancePlaceOrderResponseDiagnostic(diagnostic) {
  const parts = [];
  if (diagnostic.httpStatus != null) parts.push(`HTTP ${diagnostic.httpStatus}`);
  if (diagnostic.contentType) parts.push(diagnostic.contentType);

  const retryAfter = formatRetryAfter(diagnostic.retryAfter);
  if (retryAfter) parts.push(retryAfter);

  const orderCounts = [];
  if (diagnostic.orderCount10s != null) {
    orderCounts.push(`X-MBX-ORDER-COUNT-10S=${diagnostic.orderCount10s}`);
  }
  if (diagnostic.orderCount1m != null) {
    orderCounts.push(`X-MBX-ORDER-COUNT-1M=${diagnostic.orderCount1m}`);
  }
  if (orderCounts.length > 0) parts.push(orderCounts.join(' · '));
  if (diagnostic.usedWeight1m != null) {
    parts.push(`X-MBX-USED-WEIGHT-1M=${diagnostic.usedWeight1m}`);
  }

  if (diagnostic.bodyKind === 'non_json') {
    parts.push('non-JSON');
  } else if (diagnostic.bodyKind === 'invalid_json') {
    parts.push(`JSON parse error${diagnostic.errorName ? ` ${diagnostic.errorName}` : ''}`);
  } else if (diagnostic.bodyKind === 'network_error') {
    parts.push(`network error${diagnostic.errorName ? ` ${diagnostic.errorName}` : ''}`);
  } else if (diagnostic.bodyKind === 'observation_error') {
    parts.push(`response observer error${diagnostic.errorName ? ` ${diagnostic.errorName}` : ''}`);
  } else if (diagnostic.bodyKind === 'json') {
    const summary = diagnostic.payloadSummary;
    if (!summary) throw new Error('下单 JSON 响应摘要缺失');
    if (summary.success != null) parts.push(`success=${summary.success}`);
    if (summary.code != null) parts.push(`code=${summary.code}`);
    if (summary.message) parts.push(`message=${summary.message}`);
    if (summary.payloadKeys.length > 0) parts.push(`keys=${summary.payloadKeys.join(',')}`);
    else parts.push(`JSON type=${summary.payloadType}`);
    if (summary.dataKeys.length > 0) parts.push(`data.keys=${summary.dataKeys.join(',')}`);
  } else {
    throw new Error(`未知下单响应类型：${diagnostic.bodyKind}`);
  }

  return parts.join(' · ');
}
