import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { captureStrategyError } from '../../helpers/strategy-migration-boundaries.js';
import {
  compareStrategy29Timeframes,
  validateStrategy29EventsResponse,
  validateStrategy29GatewayError,
  validateStrategy29StatusResponse,
} from '../../../src/binance-strategy29-bollinger/core/remote-summary-contract.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

test('user sees supported timeframes ordered by duration instead of spelling', () => {
  // Given observer rows arrive in mixed minute, hour, day, and week order
  const timeframes = ['1w', '30m', '1d', '4h', '1m'];

  // When the public comparator orders the displayed timeframes
  const ordered = timeframes.toSorted(compareStrategy29Timeframes);
  const equal = compareStrategy29Timeframes('4h', '4h');

  // Then short durations precede long durations and equal intervals remain equal
  assert.deepEqual(ordered, ['1m', '30m', '4h', '1d', '1w']);
  assert.equal(equal, 0);
});

for (const [left, right] of [['1s', '1m'], ['1m', '60m'], [null, '1d']]) {
  test(`user rejects unsupported timeframe comparison ${left} to ${right}`, () => {
    // Given one requested timeframe is outside the observer contract
    const input = [left, right];

    // When those timeframes are compared
    const failure = captureStrategyError(() => compareStrategy29Timeframes(...input));

    // Then the invalid duration is reported instead of receiving a sorting position
    assert.equal(failure.constructor, TypeError);
    assert.equal(failure.message, 'Strategy29 timeframe is invalid');
  });
}

for (const { label, change, expected } of [
  { label: 'null status envelope', change: () => null, expected: 'status response must be an object' },
  { label: 'array status envelope', change: () => [], expected: 'status response must be an object' },
  { label: 'non-array processing units', change: value => ({ ...value, units: {} }), expected: 'status.units must be an array' },
  { label: 'overlong processing reason', change: value => { value.units[0].reason = 'x'.repeat(257); return value; }, expected: 'status.units[0].reason exceeds 256 characters' },
  { label: 'uppercase last event identity', change: value => { value.units[0].last_event_id = 'A'.repeat(64); return value; }, expected: 'status.units[0].last_event_id must be null or a lowercase hexadecimal event id' },
  { label: 'non-string last event identity', change: value => { value.units[0].last_event_id = 42; return value; }, expected: 'status.units[0].last_event_id must be null or a lowercase hexadecimal event id' },
  { label: 'another source monitor', change: value => { value.universe.source_monitor = 'monitor27'; return value; }, expected: 'status.universe.source_monitor is invalid' },
  { label: 'non-finite last success age', change: value => { value.universe.last_success_age_seconds = Infinity; return value; }, expected: 'status.universe.last_success_age_seconds must be a finite number' },
  { label: 'nonempty unavailable selection', change: value => { value.universe.refresh_status = 'fail_closed'; value.universe.reason = 'selection_fail_closed'; return value; }, expected: 'status.universe unavailable selection must be empty' },
]) {
  test(`user rejects observer status with ${label}`, () => {
    // Given a wire snapshot contains the identified malformed field
    const candidate = change(structuredClone(status));

    // When the real status validator checks the snapshot
    const failure = captureStrategyError(() => validateStrategy29StatusResponse(candidate, 200));

    // Then the failure identifies the invalid field precisely
    assert.equal(failure.constructor, TypeError);
    assert.equal(failure.message, expected);
  });
}

for (const key of ['selected_markets', 'configured_timeframes']) {
  for (const shape of ['non-array', 'duplicate', 'oversized']) {
    test(`user rejects ${shape} universe collections for ${key}`, () => {
      // Given universe admission contains an invalid bounded collection
      const candidate = structuredClone(status);
      const first = candidate.universe[key][0];
      candidate.universe[key] = shape === 'non-array' ? {}
        : shape === 'duplicate' ? [first, first]
          : Array.from({ length: 129 }, (_, index) => key === 'selected_markets' ? `ASSET${index}/USDT:USDT` : `${index + 1}m`);

      // When the real status validator checks its admission facts
      const failure = captureStrategyError(() => validateStrategy29StatusResponse(candidate, 200));

      // Then the collection is rejected before any selected units are accepted
      assert.equal(failure.constructor, TypeError);
      assert.equal(failure.message, `status.universe.${key} must be a bounded unique array`);
    });
  }
}

for (const { label, validate, body } of [
  { label: 'status', validate: validateStrategy29StatusResponse, body: status },
  { label: 'events', validate: validateStrategy29EventsResponse, body: events },
]) {
  test(`user does not accept a successful ${label} body under an HTTP failure`, () => {
    // Given an otherwise valid payload arrived with an unsuccessful transport status
    const candidate = structuredClone(body);

    // When its success contract receives HTTP 503
    const failure = captureStrategyError(() => validate(candidate, 503));

    // Then transport failure cannot be presented as current observer data
    assert.equal(failure.constructor, TypeError);
    assert.equal(failure.message, `${label} response requires HTTP 200, received 503`);
  });
}

for (const { label, change, expected } of [
  { label: 'string pagination flag', change: value => { value.has_more = 'false'; }, expected: 'events.has_more must be boolean' },
  { label: 'non-array event collection', change: value => { value.events = {}; }, expected: 'events.events must be an array' },
  { label: 'uppercase event identity', change: value => { value.events[0].event_id = 'F'.repeat(64); }, expected: 'events.events[0].event_id must be a lowercase hexadecimal event id' },
  { label: 'equal opening and closing times', change: value => { value.events[0].bar_close_ms = value.events[0].bar_open_ms; }, expected: 'events.events[0].bar_close_ms must follow bar_open_ms' },
  { label: 'reversed warning price bounds', change: value => { value.events[0].warning_high = value.events[0].warning_low - 1; }, expected: 'events.events[0].warning_high must not be below warning_low' },
  { label: 'numeric text close price', change: value => { value.events[0].close_price = '100'; }, expected: 'events.events[0].close_price must be a finite number' },
  { label: 'null marker price', change: value => { value.events[0].marker_price = null; }, expected: 'events.events[0].marker_price must be a finite number' },
  { label: 'overlong delivery failure reason', change: value => { value.events[0].delivery_failure_reason = 'x'.repeat(513); }, expected: 'events.events[0].delivery_failure_reason exceeds 512 characters' },
]) {
  test(`user rejects recent events with ${label}`, () => {
    // Given an event page contains the identified malformed transport field
    const candidate = structuredClone(events);
    change(candidate);

    // When the real event contract validates that page
    const failure = captureStrategyError(() => validateStrategy29EventsResponse(candidate, 200));

    // Then no partial event page is accepted and the failure names the field
    assert.equal(failure.constructor, TypeError);
    assert.equal(failure.message, expected);
  });
}

for (const [direction, type, side] of [
  ['bearish', 'warning', 'short'], ['bearish', 'confirmed', 'short'], ['bearish', 'reversal', 'long'],
  ['bullish', 'warning', 'long'], ['bullish', 'confirmed', 'long'], ['bullish', 'reversal', 'short'],
]) {
  test(`user accepts ${direction} ${type} only with its ${side} signal side`, () => {
    // Given the observer emits the specified directional signal
    const candidate = structuredClone(events);
    candidate.events = [{ ...candidate.events[0], setup_direction: direction, signal_type: type, signal_side: side }];
    const contradictory = structuredClone(candidate);
    contradictory.events[0].signal_side = side === 'long' ? 'short' : 'long';

    // When both the coherent and contradictory signal pages are validated
    const accepted = validateStrategy29EventsResponse(candidate, 200);
    const failure = captureStrategyError(() => validateStrategy29EventsResponse(contradictory, 200));

    // Then the original coherent page survives while the opposite side is rejected
    assert.equal(accepted, candidate);
    assert.equal(accepted.events[0].signal_side, side);
    assert.equal(failure.message, 'events.events[0].signal_side does not match direction and signal type');
  });
}

test('user retains exact processing and delivery reason length boundaries', () => {
  // Given status and event reasons use their maximum supported lengths
  const statusCandidate = structuredClone(status);
  statusCandidate.units[0].reason = 's'.repeat(256);
  const eventCandidate = structuredClone(events);
  eventCandidate.events[0].delivery_failure_reason = 'e'.repeat(512);

  // When the public wire validators inspect those boundary values
  const acceptedStatus = validateStrategy29StatusResponse(statusCandidate, 200);
  const acceptedEvents = validateStrategy29EventsResponse(eventCandidate, 200);

  // Then the full original values are preserved without truncation
  assert.equal(acceptedStatus, statusCandidate);
  assert.equal(acceptedEvents, eventCandidate);
  assert.equal(acceptedStatus.units[0].reason.length, 256);
  assert.equal(acceptedEvents.events[0].delivery_failure_reason.length, 512);
});

for (const [httpStatus, expected] of [[400, 'invalid_request'], [401, 'unauthorized'], [503, 'database_unavailable']]) {
  test(`user rejects an incorrect gateway error identity for HTTP ${httpStatus}`, () => {
    // Given the gateway transport and its error body disagree
    const body = { schema_version: 1, error: 'incorrect_error' };

    // When the error contract checks the reported status
    const failure = captureStrategyError(() => validateStrategy29GatewayError(body, httpStatus));

    // Then the expected wire error identity remains explicit
    assert.equal(failure.constructor, TypeError);
    assert.equal(failure.message, `gateway error.error must equal ${expected}`);
  });
}

test('user rejects an expired-cursor response that claims a different error', () => {
  // Given a conflict body includes a cursor but does not identify cursor expiry
  const body = { schema_version: 1, error: 'unauthorized', oldest_cursor: 42 };

  // When the error contract validates HTTP 409
  const failure = captureStrategyError(() => validateStrategy29GatewayError(body, 409));

  // Then the cursor cannot be used to restart an unrelated failure
  assert.equal(failure.message, 'gateway error.error must equal cursor_expired');
});

test('user rejects an unsupported gateway transport status', () => {
  // Given a gateway intermediary returns an unsupported status code
  const body = { schema_version: 1, error: 'database_unavailable' };

  // When its error body is checked under HTTP 502
  const failure = captureStrategyError(() => validateStrategy29GatewayError(body, 502));

  // Then the unknown failure is explicit instead of being classified as recoverable
  assert.equal(failure.message, 'unsupported gateway HTTP status 502');
});
