import testPolicy from './scripts/test-policy/eslint-plugin.js';
import { contractCallAllowances } from './scripts/test-policy/migration-inventory.js';

export default [
  {
    name: 'historical-install-artifacts',
    ignores: ['test/fixtures/**'],
  },
  {
    name: 'test-policy',
    files: ['test/**/*.{js,mjs}', 'e2e/**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    linterOptions: { noInlineConfig: true },
    plugins: { 'test-policy': testPolicy },
    rules: {
      'test-policy/no-focused-tests': 'error',
      'test-policy/no-uncontracted-mocks': 'error',
      'test-policy/no-fixed-waits': 'error',
      'test-policy/no-vacuous-tests': 'error',
    },
  },
  {
    name: 'behavioral-test-contracts',
    files: ['test/**/*.test.js', 'e2e/**/specs/**/*.pw.js'],
    rules: { 'test-policy/behavior-contract': 'error' },
  },
  ...contractCallAllowances.map(({ file, rule, allow }) => ({
    name: `bounded-call-inventory:${file}:${rule}`,
    files: [file],
    rules: { [`test-policy/${rule}`]: ['error', { allow }] },
  })),
];
