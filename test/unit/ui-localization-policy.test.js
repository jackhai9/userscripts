import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import config from '../../eslint.config.js';

function lint(code) {
  return new Linter({ cwd: fileURLToPath(new URL('../../', import.meta.url)) })
    .verify(code, config, { filename: 'src/binance-orderbook-trade/index.user.js' })
    .map(({ ruleId, messageId }) => ({ ruleId, messageId }));
}

for (const source of [
  "setAutomaticUsdtRebalanceStatus('Automatic transfer completed');",
  "setLadderStatus('账户操作已阻止');",
  'setLadderStatus(`Submitted ${count} orders`);',
  "setLadderStatus('Submitted ' + count);",
  "setLadderStatus(waiting ? 'Waiting' : PANEL_COPY.state.idle);",
  "setAutomaticUsdtRebalanceStatus(PANEL_COPY.state.idle, 'Still waiting');",
]) {
  test(`user cannot introduce unpaired status copy: ${source}`, () => {
    // Given a script writes untranslated text or a tooltip to a status sink.
    const code = source;
    // When the production source lint configuration checks the code.
    const messages = lint(code);
    // Then the missing language pair blocks the change.
    assert.deepEqual(messages, [{ ruleId: 'ui-copy/no-raw-status-copy', messageId: 'unpaired' }]);
  });
}

test('user can retain paired statuses and unchanged external diagnostics', () => {
  // Given paired status values, numeric details, and an external diagnostic.
  const code = `
    setLadderStatus(PANEL_COPY.state.idle);
    setLadderStatus(localizedText('等待', 'Waiting'));
    setAutomaticUsdtRebalanceStatus(combineLocalizedText([PANEL_COPY.state.idle, error.message]), error.message);
    setLadderStatus(count + '/' + total);
    setLadderStatus('');
  `;
  // When the production source lint configuration checks these boundaries.
  const messages = lint(code);
  // Then it accepts localized values without rewriting diagnostic data.
  assert.deepEqual(messages, []);
});
