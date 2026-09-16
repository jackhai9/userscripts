import test from 'node:test';
import assert from 'node:assert/strict';
import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';

test('user receives the original failure from an operation observed by the test boundary', () => {
  // Given an operation records its input before rejecting that request
  const requested = [];
  const rejection = new Error('unsupported quantity');
  const operation = () => {
    requested.push('0.001');
    throw rejection;
  };

  // When the boundary invokes the operation once
  const failure = captureThrownError(operation);

  // Then the request and original rejection are preserved
  assert.deepEqual(requested, ['0.001']);
  assert.equal(failure, rejection);
});

test('user receives no reported failure after a successful observed operation', () => {
  // Given an operation records its accepted request
  const accepted = [];

  // When the boundary executes the successful operation
  const failure = captureThrownError(() => accepted.push('0.01'));

  // Then its side effect occurs exactly once without a synthetic error
  assert.deepEqual(accepted, ['0.01']);
  assert.equal(failure, null);
});
