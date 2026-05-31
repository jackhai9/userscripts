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
