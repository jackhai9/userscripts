import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyOrderFeedback,
  evaluateOrderSubmitAcknowledgement,
  formatBinancePlaceOrderResponseDiagnostic,
  getBinanceApiErrorCode,
  isBinancePlaceOrderSuccessPayload,
  isBinanceMaxOpenOrdersErrorCode,
  isBinancePostOnlyMakerRejectCode,
  isOpenLadderOpenOrdersCapacityFeedback,
  isPostOnlyMakerRejectionFeedback,
  isPotentialOrderFeedbackText,
  isReduceOnlyOpenOrdersConflictFeedback,
  readConfirmedReduceOnlyRejection,
  resolveBinanceSubmitResponseRecovery,
  summarizeBinancePlaceOrderPayload,
} from '../../../src/binance-orderbook-trade/core/order-feedback.js';

test('user recovers a reduce-only conflict only from one settled native close rejection', () => {
  // Given a verified rejection plus observations with missing, duplicate, or contradictory evidence.
  const apiError = { success: false, code: 90802022, message: 'Reduce-only order failed' };
  const observation = {
    settled: true,
    diagnostics: [{ httpStatus: 200, bodyKind: 'json', payloadSummary: apiError }],
    apiErrors: [apiError],
  };
  const patches = [
    { settled: false },
    { diagnostics: [] },
    { diagnostics: [observation.diagnostics[0], observation.diagnostics[0]] },
    { apiErrors: [] },
    { apiErrors: [apiError, apiError] },
    { apiErrors: [{ ...apiError, success: true }] },
    { apiErrors: [{ ...apiError, code: 90802025 }] },
    ...[null, 0, 400, 503].map((httpStatus) => ({ diagnostics: [{ ...observation.diagnostics[0], httpStatus }] })),
    { diagnostics: [{ ...observation.diagnostics[0], bodyKind: 'invalid_json' }] },
    { diagnostics: [{ ...observation.diagnostics[0], payloadSummary: { ...apiError, success: true } }] },
    { diagnostics: [{ ...observation.diagnostics[0], payloadSummary: { ...apiError, code: 90802025 } }] },
  ];
  const cases = [
    { mode: 'CLOSE', observation, successes: [], expected: apiError },
    { mode: 'CLOSE', observation: { ...observation, diagnostics: [{ ...observation.diagnostics[0], payloadSummary: { ...apiError, code: '90802022' } }] }, successes: [], expected: apiError },
    { mode: 'OPEN', observation, successes: [], expected: null },
    { mode: 'CLOSE', observation, successes: [{}], expected: null },
    ...patches.map((patch) => ({ mode: 'CLOSE', observation: { ...observation, ...patch }, successes: [], expected: null })),
    { mode: 'CLOSE', observation: { ...observation, diagnostics: [{ httpStatus: 200, bodyKind: 'json' }] }, successes: [], expected: null },
  ];

  // When native response evidence is checked for safe reduce-only recovery.
  const results = cases.map((entry) => readConfirmedReduceOnlyRejection(entry.mode, entry.observation, entry.successes));

  // Then only a single successful HTTP JSON rejection with no successful submission qualifies.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user gets the defined recovery policy for rate limits and server uncertainty', () => {
  // Given rate-limited, server-error, and terminal client-error response evidence.
  const cases = [
    { read: resolveBinanceSubmitResponseRecovery, args: [[
      { httpStatus: 429, retryAfter: '7' },
    ], []], expected: {
      kind: 'rate_limited',
      cooldownMs: 7000,
    } },
    { read: resolveBinanceSubmitResponseRecovery, args: [[
      { httpStatus: 200, retryAfter: null },
    ], [{ code: -1003 }]], expected: {
      kind: 'rate_limited',
      cooldownMs: 10000,
    } },
    { read: resolveBinanceSubmitResponseRecovery, args: [[
      { httpStatus: 503, retryAfter: null },
    ], []], expected: {
      kind: 'submit_unconfirmed',
      cooldownMs: 3000,
    } },
    { read: resolveBinanceSubmitResponseRecovery, args: [[
      { httpStatus: 400, retryAfter: null },
    ], []], expected: null },
    { read: resolveBinanceSubmitResponseRecovery, args: [[
      { httpStatus: 403, retryAfter: null },
    ], []], expected: null },
  ];

  // When response recovery is classified.
  const results = cases.map(({ read, args }) => read(...args));

  // Then the kind and cooldown match the observed failure.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user sees localized order feedback classified by its business outcome', () => {
  // Given Chinese and English success, failure, and unrelated messages.
  const cases = [
    { read: classifyOrderFeedback, args: ['委托已提交'], expected: 'success' },
    { read: classifyOrderFeedback, args: ['Order placed successfully'], expected: 'success' },
    { read: classifyOrderFeedback, args: ['设置成功'], expected: 'unknown' },
    { read: classifyOrderFeedback, args: ['余额不足，下单失败'], expected: 'failure' },
    { read: classifyOrderFeedback, args: ['Order rejected'], expected: 'failure' },
    { read: classifyOrderFeedback, args: ['请确认订单参数'], expected: 'unknown' },
  ];

  // When the order messages are classified.
  const results = cases.map(({ read, args }) => read(...args));

  // Then each message retains its concrete success, failure, or unknown outcome.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user cannot count an order from absent or stale success feedback', () => {
  // Given a recovered native button with absent feedback or an old success message.
  const cases = [
    { read: evaluateOrderSubmitAcknowledgement, args: [{
      feedback: '',
      isNewFeedback: true,
      sawBusy: true,
      busy: false,
    }], expected: { status: 'pending' } },
    { read: evaluateOrderSubmitAcknowledgement, args: [{
      feedback: '委托已提交',
      isNewFeedback: false,
      sawBusy: true,
      busy: false,
    }], expected: { status: 'pending' } },
  ];

  // When submission acknowledgement evaluates the feedback.
  const results = cases.map(({ read, args }) => read(...args));

  // Then both outcomes remain pending.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user gets confirmation only from a new order success message', () => {
  // Given fresh localized successes, an unrelated success, and a concrete order failure.
  const cases = [
    { read: evaluateOrderSubmitAcknowledgement, args: [{
      feedback: '委托已提交',
      isNewFeedback: true,
      sawBusy: false,
      busy: false,
    }], expected: { status: 'success' } },
    { read: evaluateOrderSubmitAcknowledgement, args: [{
      feedback: 'Order placed successfully',
      isNewFeedback: true,
      sawBusy: false,
      busy: false,
    }], expected: { status: 'success' } },
    { read: evaluateOrderSubmitAcknowledgement, args: [{
      feedback: '设置成功',
      isNewFeedback: true,
      sawBusy: false,
      busy: false,
    }], expected: { status: 'pending' } },
    { read: evaluateOrderSubmitAcknowledgement, args: [{
      feedback: '下单失败：余额不足',
      isNewFeedback: true,
      sawBusy: false,
      busy: false,
    }], expected: { status: 'failure', message: '下单失败：余额不足' } },
  ];

  // When submission acknowledgements are evaluated.
  const results = cases.map(({ read, args }) => read(...args));

  // Then orders succeed only on relevant feedback and failures keep their text.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user can distinguish reduce-only order conflicts from unrelated failures', () => {
  // Given reduce-only messages naming existing orders plus generic failure and success text.
  const cases = [
    { read: isReduceOnlyOpenOrdersConflictFeedback, args: ['只减仓订单失败。请取消此币种的当前挂单，然后重试。'], expected: true },
    { read: isReduceOnlyOpenOrdersConflictFeedback, args: ['只减仓订单失败。如果您有该合约的未平仓头寸和挂单，请取消挂单后重试。如果您没有任何仓位，请取消只减仓选项后重试。'], expected: true },
    { read: isReduceOnlyOpenOrdersConflictFeedback, args: ['下单失败：余额不足'], expected: false },
    { read: isReduceOnlyOpenOrdersConflictFeedback, args: ['委托已提交'], expected: false },
  ];

  // When the feedback is checked for a reduce-only open-order conflict.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only messages containing both conflict semantics match.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user cannot cancel orders from an insufficient-balance message alone', () => {
  // Given capacity failures with and without an explicit open-order hint.
  const cases = [
    { read: isOpenLadderOpenOrdersCapacityFeedback, args: ['可开数量不足，请取消当前挂单后重试'], expected: true },
    { read: isOpenLadderOpenOrdersCapacityFeedback, args: ['Order failed: insufficient margin from existing open orders'], expected: true },
    { read: isOpenLadderOpenOrdersCapacityFeedback, args: ['下单失败：余额不足'], expected: false },
    { read: isOpenLadderOpenOrdersCapacityFeedback, args: ['可用余额不足'], expected: false },
    { read: isOpenLadderOpenOrdersCapacityFeedback, args: ['可开数量不足'], expected: false },
    { read: isOpenLadderOpenOrdersCapacityFeedback, args: ['Order failed: insufficient margin'], expected: false },
    { read: isOpenLadderOpenOrdersCapacityFeedback, args: ['Order failed: not enough available balance'], expected: false },
    { read: isOpenLadderOpenOrdersCapacityFeedback, args: ['只减仓订单失败。请取消此币种的当前挂单，然后重试。'], expected: false },
    { read: isOpenLadderOpenOrdersCapacityFeedback, args: ['委托已提交'], expected: false },
  ];

  // When the open-ladder conflict classifier evaluates the messages.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only a capacity failure tied to open orders matches.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user sees Binance error codes independently of the message language', () => {
  // Given numeric, numeric-string, zero, malformed, unsafe, missing, and nested codes.
  const cases = [
    { read: getBinanceApiErrorCode, args: [{ code: -5022, msg: 'any text' }], expected: -5022 },
    { read: getBinanceApiErrorCode, args: [{ code: '-5022', message: '任意文案' }], expected: -5022 },
    { read: getBinanceApiErrorCode, args: [{ code: 90805022, message: '任意文案' }], expected: 90805022 },
    { read: getBinanceApiErrorCode, args: [{ code: '90805022', message: '任意文案' }], expected: 90805022 },
    { read: getBinanceApiErrorCode, args: [{ code: 0, success: true }], expected: null },
    { read: getBinanceApiErrorCode, args: [{ code: '000000', success: true }], expected: null },
    { read: getBinanceApiErrorCode, args: [{ code: -2019, msg: 'insufficient margin' }], expected: -2019 },
    { read: getBinanceApiErrorCode, args: [{ code: 1.5, msg: 'invalid numeric code' }], expected: null },
    { read: getBinanceApiErrorCode, args: [{ code: '1.5', msg: 'invalid numeric code' }], expected: null },
    { read: getBinanceApiErrorCode, args: [{ code: Number.MAX_SAFE_INTEGER + 1 }], expected: null },
    { read: getBinanceApiErrorCode, args: [{ message: 'Post Only order rejected' }], expected: null },
    { read: getBinanceApiErrorCode, args: [{ data: { code: -5022 } }], expected: null },
  ];

  // When the top-level response code is read.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only exact safe nonzero integer codes are retained.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user counts a submission only from the verified native success payload', () => {
  // Given valid success payloads, conflicting codes, and incomplete response shapes.
  const cases = [
    { read: isBinancePlaceOrderSuccessPayload, args: [{ code: 0, success: true }], expected: true },
    { read: isBinancePlaceOrderSuccessPayload, args: [{ code: '000000', success: true }], expected: true },
    { read: isBinancePlaceOrderSuccessPayload, args: [{ success: true, data: {} }], expected: true },
    { read: isBinancePlaceOrderSuccessPayload, args: [{ code: -5022, success: true }], expected: false },
    { read: isBinancePlaceOrderSuccessPayload, args: [{ code: '90805022', success: true }], expected: false },
    { read: isBinancePlaceOrderSuccessPayload, args: [{ code: 0 }], expected: false },
    { read: isBinancePlaceOrderSuccessPayload, args: [{ success: false }], expected: false },
    { read: isBinancePlaceOrderSuccessPayload, args: [{}], expected: false },
    { read: isBinancePlaceOrderSuccessPayload, args: [[]], expected: false },
    { read: isBinancePlaceOrderSuccessPayload, args: [null], expected: false },
  ];

  // When the native response is checked for success.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only explicit success without an error code counts.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user can inspect an uncertain response without retaining submitted order values', () => {
  // Given an uncertain payload with an order identifier, price, and quantity.
  const cases = [
    { read: summarizeBinancePlaceOrderPayload, args: [{
      code: '000000',
      success: false,
      message: 'Request was throttled',
      data: {
        orderId: 123456789,
        price: '0.16380',
        quantity: '1',
      },
    }], expected: {
      payloadType: 'object',
      payloadKeys: ['code', 'data', 'message', 'success'],
      dataKeys: ['orderId', 'price', 'quantity'],
      success: false,
      code: '000000',
      message: 'Request was throttled',
    } },
  ];

  // When a bounded response summary is constructed.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only top-level evidence and data field names remain.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user sees rate-limit evidence without submitted order values', () => {
  // Given rate-limit response headers and a non-JSON body classification.
  const diagnostic = {
    httpStatus: 429,
    contentType: 'text/html; charset=utf-8',
    retryAfter: '2',
    orderCount10s: '301',
    orderCount1m: '801',
    usedWeight1m: '2401',
    bodyKind: 'non_json',
    payloadSummary: null,
    errorName: null,
  };

  // When the bounded response evidence is formatted.
  const detail = formatBinancePlaceOrderResponseDiagnostic(diagnostic);

  // Then status, retry delay, and counter headers remain visible without order data.
  assert.equal(detail, 'HTTP 429 · text/html; charset=utf-8 · Retry-After 2s · X-MBX-ORDER-COUNT-10S=301 · X-MBX-ORDER-COUNT-1M=801 · X-MBX-USED-WEIGHT-1M=2401 · non-JSON');
  assert.doesNotMatch(detail, /orderId|0\.16380|123456789/);
});

test('user sees response shape or JSON parse failure in order diagnostics', () => {
  // Given an unknown JSON result and an HTTP 502 JSON parse error.
  const cases = [
    { read: formatBinancePlaceOrderResponseDiagnostic, args: [{
      httpStatus: 200,
      contentType: 'application/json',
      retryAfter: null,
      orderCount10s: null,
      orderCount1m: null,
      usedWeight1m: null,
      bodyKind: 'json',
      payloadSummary: summarizeBinancePlaceOrderPayload({
        code: '000000',
        success: false,
        message: 'Unknown result',
        data: { orderId: 123456789 },
      }),
      errorName: null,
    }], expected: 'HTTP 200 · application/json · success=false · code=000000 · message=Unknown result · keys=code,data,message,success · data.keys=orderId' },
    { read: formatBinancePlaceOrderResponseDiagnostic, args: [{
      httpStatus: 502,
      contentType: 'application/json',
      retryAfter: null,
      orderCount10s: null,
      orderCount1m: null,
      usedWeight1m: null,
      bodyKind: 'invalid_json',
      payloadSummary: null,
      errorName: 'SyntaxError',
    }], expected: 'HTTP 502 · application/json · JSON parse error SyntaxError' },
  ];

  // When the diagnostic evidence is formatted.
  const results = cases.map(({ read, args }) => read(...args));

  // Then the displayed text preserves each distinct failure and only data field names.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user recognizes only verified numeric Post Only rejection codes', () => {
  // Given verified maker codes plus string, success, unrelated, and adjacent codes.
  const cases = [
    { read: isBinancePostOnlyMakerRejectCode, args: [-5022], expected: true },
    { read: isBinancePostOnlyMakerRejectCode, args: [90805022], expected: true },
    { read: isBinancePostOnlyMakerRejectCode, args: ['90805022'], expected: false },
    { read: isBinancePostOnlyMakerRejectCode, args: [0], expected: false },
    { read: isBinancePostOnlyMakerRejectCode, args: [-2019], expected: false },
    { read: isBinancePostOnlyMakerRejectCode, args: [90805021], expected: false },
  ];

  // When the maker code classifier evaluates each value.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only the two verified numeric codes match.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user identifies the verified maximum-open-orders code', () => {
  // Given the verified numeric capacity code and two nonmatching values.
  const cases = [
    { read: isBinanceMaxOpenOrdersErrorCode, args: [90802025], expected: true },
    { read: isBinanceMaxOpenOrdersErrorCode, args: ['90802025'], expected: false },
    { read: isBinanceMaxOpenOrdersErrorCode, args: [90805022], expected: false },
  ];

  // When the maximum-open-orders classifier evaluates the codes.
  const results = cases.map(({ read, args }) => read(...args));

  // Then only the observed numeric code matches.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user recognizes maker-execution rejections across localized message variants', () => {
  // Given Chinese and English Post Only messages preserving maker conflict and rejection semantics.
  const cases = [
    { read: isPostOnlyMakerRejectionFeedback, args: ['由于该只做Maker订单(Post Only)未作为Maker执行，因此将被拒绝。该订单不会记录在订单历史记录中。'], expected: true },
    { read: isPostOnlyMakerRejectionFeedback, args: ['只做 Maker 订单无法作为 Maker 成交，已被拒绝。'], expected: true },
    { read: isPostOnlyMakerRejectionFeedback, args: ['Due to the order could not be executed as maker, the Post Only order will be rejected.'], expected: true },
    { read: isPostOnlyMakerRejectionFeedback, args: ['The Post-Only order cannot execute as a maker and was rejected without being recorded.'], expected: true },
  ];

  // When the feedback is classified by those semantics.
  const results = cases.map(({ read, args }) => read(...args));

  // Then each verified localized variant is recognized.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user cannot infer a maker-price conflict from an incomplete rejection message', () => {
  // Given generic, FOK, reduce-only, and incomplete Post Only rejection messages.
  const cases = [
    { read: isPostOnlyMakerRejectionFeedback, args: ['Order rejected'], expected: false },
    { read: isPostOnlyMakerRejectionFeedback, args: ['只做Maker (Post Only) 状态丢失'], expected: false },
    { read: isPostOnlyMakerRejectionFeedback, args: ['Post Only order rejected'], expected: false },
    { read: isPostOnlyMakerRejectionFeedback, args: ['订单未作为Maker执行，因此将被拒绝'], expected: false },
    { read: isPostOnlyMakerRejectionFeedback, args: ['FOK order could not be filled immediately and was rejected'], expected: false },
    { read: isPostOnlyMakerRejectionFeedback, args: ['只减仓订单失败，请取消当前挂单后重试'], expected: false },
  ];

  // When maker-conflict evidence is evaluated.
  const results = cases.map(({ read, args }) => read(...args));

  // Then none of the incomplete or unrelated messages authorizes that classification.
  cases.forEach(({ expected }, index) => assert.deepEqual(results[index], expected));
});

test('user cannot infer an order result or recovery from absent feedback', () => {
  // Given empty feedback and unrelated page text before a new order response arrives.
  const texts = ['', null];

  // When the feedback classifiers inspect that evidence.
  const results = texts.map((text) => ({
    potential: isPotentialOrderFeedbackText(text),
    kind: classifyOrderFeedback(text),
    reduceOnly: isReduceOnlyOpenOrdersConflictFeedback(text),
    capacity: isOpenLadderOpenOrdersCapacityFeedback(text),
    maker: isPostOnlyMakerRejectionFeedback(text),
  }));
  const potentialMessages = ['Order rejected', '委托已提交', 'Settings saved'].map(isPotentialOrderFeedbackText);

  // Then empty evidence stays absent and unrelated text is not an order result.
  results.forEach((result) => assert.deepEqual(result, {
    potential: false, kind: 'none', reduceOnly: false, capacity: false, maker: false,
  }));
  assert.deepEqual(potentialMessages, [true, true, false]);
});

for (const { name, retryAfter, expectedMs } of [
  { name: 'zero', retryAfter: '0', expectedMs: 0 },
  { name: 'fractional seconds', retryAfter: '0.25', expectedMs: 250 },
  { name: 'missing', retryAfter: null, expectedMs: 10000 },
  { name: 'empty', retryAfter: '', expectedMs: 10000 },
  { name: 'negative', retryAfter: '-1', expectedMs: 10000 },
  { name: 'non-numeric', retryAfter: 'not-a-delay', expectedMs: 10000 },
]) {
  test(`user applies the defined rate-limit wait when Retry-After is ${name}`, () => {
    // Given a blocked HTTP 418 response and its observed Retry-After header.
    const diagnostics = [{ httpStatus: 418, retryAfter }];

    // When response recovery resolves the rate-limit delay.
    const recovery = resolveBinanceSubmitResponseRecovery(diagnostics, []);

    // Then valid nonnegative seconds are honored and invalid evidence uses the rate-limit policy.
    assert.deepEqual(recovery, { kind: 'rate_limited', cooldownMs: expectedMs });
  });
}

test('user keeps rate-limit precedence when the same submission also reports server uncertainty', () => {
  // Given a server response and an explicit Binance rate-limit code in one observation.
  const diagnostics = [{ httpStatus: 503 }];
  const errors = [{ code: -1003 }];

  // When response recovery classifies the combined evidence.
  const recovery = resolveBinanceSubmitResponseRecovery(diagnostics, errors);

  // Then the longer rate-limit cooldown governs the next action.
  assert.deepEqual(recovery, { kind: 'rate_limited', cooldownMs: 10000 });
});

for (const { name, diagnostics, errors } of [
  { name: 'diagnostics are unavailable', diagnostics: null, errors: [] },
  { name: 'API errors are unavailable', diagnostics: [], errors: null },
]) {
  test(`user gets an explicit contract error when ${name}`, () => {
    // Given incomplete response evidence rather than a confirmed rejection.
    const evidence = { diagnostics, errors };

    // When recovery classification is requested with that incomplete contract.
    const classify = () => resolveBinanceSubmitResponseRecovery(evidence.diagnostics, evidence.errors);

    // Then recovery fails explicitly rather than inventing an outcome.
    assert.throws(classify, /下单响应恢复证据无效/);
  });
}

test('user does not read error codes from primitive, array, or unsafe response values', () => {
  // Given non-object payloads and a numeric string outside the safe integer range.
  const payloads = [null, [], '90802022', { code: '9007199254740992' }];

  // When the top-level Binance error-code contract is evaluated.
  const codes = payloads.map(getBinanceApiErrorCode);

  // Then malformed response shapes and unsafe integers remain unknown.
  assert.deepEqual(codes, [null, null, null, null]);
});

for (const { name, payload, expectedType } of [
  { name: 'array', payload: [], expectedType: 'array' },
  { name: 'null', payload: null, expectedType: 'null' },
  { name: 'text', payload: 'Unavailable', expectedType: 'string' },
  { name: 'numeric', payload: 503, expectedType: 'number' },
]) {
  test(`user sees the ${name} payload type without fabricated JSON fields`, () => {
    // Given a response body that is not an object matching the native order contract.
    const body = payload;

    // When a response summary is created.
    const summary = summarizeBinancePlaceOrderPayload(body);

    // Then only the actual payload type is retained.
    assert.deepEqual(summary, {
      payloadType: expectedType, payloadKeys: [], dataKeys: [], success: null, code: null, message: null,
    });
  });
}

test('user gets a bounded normalized error message without nested response values', () => {
  // Given nested diagnostic fields, array data, and a long fallback message.
  const payload = { success: {}, code: [], data: [{ orderId: 123 }], msg: '  ' + 'failure\n'.repeat(30) };

  // When the response is summarized for display.
  const summary = summarizeBinancePlaceOrderPayload(payload);

  // Then nested values are omitted and whitespace-normalized text is capped at 160 characters.
  assert.deepEqual(summary, {
    payloadType: 'object', payloadKeys: ['code', 'data', 'msg', 'success'], dataKeys: [],
    success: null, code: null, message: 'failure '.repeat(30).trim().slice(0, 160),
  });
});

test('user sees no diagnostic message for blank or non-text response messages', () => {
  // Given an empty object and responses with blank or non-text message fields.
  const payloads = [{}, { message: ' \n ' }, { message: 123 }];

  // When those response summaries are constructed.
  const summaries = payloads.map(summarizeBinancePlaceOrderPayload);

  // Then no message is invented and only observed field names remain.
  assert.deepEqual(summaries, [
    { payloadType: 'object', payloadKeys: [], dataKeys: [], success: null, code: null, message: null },
    { payloadType: 'object', payloadKeys: ['message'], dataKeys: [], success: null, code: null, message: null },
    { payloadType: 'object', payloadKeys: ['message'], dataKeys: [], success: null, code: null, message: null },
  ]);
});

for (const { name, diagnostic, expected } of [
  { name: 'network failure', diagnostic: { bodyKind: 'network_error', errorName: 'TypeError' }, expected: 'network error TypeError' },
  { name: 'network failure without a named error', diagnostic: { bodyKind: 'network_error' }, expected: 'network error' },
  { name: 'observer failure', diagnostic: { bodyKind: 'observation_error', errorName: 'Error' }, expected: 'response observer error Error' },
  { name: 'observer failure without a named error', diagnostic: { bodyKind: 'observation_error' }, expected: 'response observer error' },
  { name: 'unnamed JSON parse failure', diagnostic: { bodyKind: 'invalid_json' }, expected: 'JSON parse error' },
  { name: 'date-valued retry header', diagnostic: { bodyKind: 'non_json', retryAfter: 'Wed, 16 Sep 2026 00:00:00 GMT' }, expected: 'Retry-After Wed, 16 Sep 2026 00:00:00 GMT · non-JSON' },
  { name: 'empty retry header', diagnostic: { bodyKind: 'non_json', retryAfter: '' }, expected: 'non-JSON' },
  { name: 'array JSON response', diagnostic: { bodyKind: 'json', payloadSummary: summarizeBinancePlaceOrderPayload([]) }, expected: 'JSON type=array' },
  { name: 'empty object JSON response', diagnostic: { bodyKind: 'json', payloadSummary: summarizeBinancePlaceOrderPayload({}) }, expected: 'JSON type=object' },
]) {
  test(`user sees precise diagnostics for ${name}`, () => {
    // Given the observed body classification and any available response metadata.
    const evidence = { ...diagnostic };

    // When order-response evidence is rendered.
    const detail = formatBinancePlaceOrderResponseDiagnostic(evidence);

    // Then the displayed reason preserves the failure without inventing missing fields.
    assert.equal(detail, expected);
  });
}

for (const { name, diagnostic, expectedError } of [
  { name: 'a JSON summary is missing', diagnostic: { bodyKind: 'json' }, expectedError: /下单 JSON 响应摘要缺失/ },
  { name: 'the body classification is unknown', diagnostic: { bodyKind: 'unknown' }, expectedError: /未知下单响应类型：unknown/ },
]) {
  test(`user gets an explicit diagnostic error when ${name}`, () => {
    // Given a response diagnostic that violates the required body contract.
    const evidence = { ...diagnostic };

    // When the invalid diagnostic is formatted.
    const format = () => formatBinancePlaceOrderResponseDiagnostic(evidence);

    // Then the missing contract is reported directly.
    assert.throws(format, expectedError);
  });
}
