/** Status data may be dynamic; this rule catches authored copy at the two UI sinks. */
function rawCopy(node) {
  if (!node) return null;
  if (node.type === 'Literal') {
    return typeof node.value === 'string' && /\p{L}/u.test(node.value) ? node : null;
  }
  if (node.type === 'TemplateLiteral') {
    if (node.quasis.some(part => /\p{L}/u.test(part.value.cooked))) return node;
    return node.expressions.map(rawCopy).find(Boolean);
  }
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    return rawCopy(node.left) || rawCopy(node.right);
  }
  if (node.type === 'ConditionalExpression') {
    return rawCopy(node.consequent) || rawCopy(node.alternate);
  }
  if (node.type === 'ArrayExpression') return node.elements.map(rawCopy).find(Boolean);
  if (node.type === 'CallExpression' && node.callee.name === 'combineLocalizedText') {
    return node.arguments.map(rawCopy).find(Boolean);
  }
  // Paired formatters and external diagnostics are checked by behavioral tests.
  return null;
}

export default {
  rules: {
    'no-raw-status-copy': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { unpaired: 'Use paired localizedText or PANEL_COPY for status text and titles.' },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (!['setLadderStatus', 'setAutomaticUsdtRebalanceStatus'].includes(node.callee.name)) return;
            for (const argument of node.arguments.slice(0, 2)) {
              const copy = rawCopy(argument);
              if (copy) context.report({ node: copy, messageId: 'unpaired' });
            }
          },
        };
      },
    },
  },
};
