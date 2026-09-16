import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBrooksMediaExportPayload, canRetryFailedBrooksMediaExport,
  formatBrooksMediaExportDuration, formatBrooksMediaExportStatus,
  getBrooksMediaExportElapsedMs, getBrooksMediaExportPageLabel,
  getBrooksMediaExportPrimaryLabel, isBrooksMediaExportComplete,
  markBrooksMediaExportRunStarted, parseBrooksMediaExportTime,
  shouldShowBrooksMediaExportReset, stopBrooksMediaExportRunTimer,
  truncateBrooksMediaExportText,
} from '../../src/m3u8-downloader/brooks-status.js';

const exportedAt = '2026-09-16T00:00:00.000Z';
const timestamp = Date.parse(exportedAt);
const courseUrl = 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/';

test('user sees no completion, retry, or elapsed claim before an export exists', () => {
  // Given the course exporter has no saved or running collection
  const state = null;

  // When its public status and control contracts inspect that initial state
  const result = {
    status: formatBrooksMediaExportStatus(), elapsed: getBrooksMediaExportElapsedMs(state, timestamp),
    label: getBrooksMediaExportPrimaryLabel(state), complete: isBrooksMediaExportComplete(state),
    retry: canRetryFailedBrooksMediaExport(state), reset: shouldShowBrooksMediaExportReset(state),
  };

  // Then initial controls offer start without claiming work or duration
  assert.deepEqual(result, { status: '', elapsed: null, label: '开始', complete: false, retry: false, reset: false });
});

test('user receives an explicit empty payload when inspecting an uninitialized export state', () => {
  // Given no collection exists at the requested export timestamp
  const state = null;

  // When the public payload contract is used for that absent state
  const payload = buildBrooksMediaExportPayload(state, exportedAt);

  // Then absence remains visible in metadata and does not become completed work
  assert.deepEqual(payload, {
    exportedAt, startedAt: null, updatedAt: null, elapsedMs: null,
    elapsedSeconds: null, elapsedText: '', total: 0, done: 0,
    completed: false, nextIndex: 0, running: false, stopped: false,
    missingIndexes: [], records: [], failures: [],
  });
});

test('user cannot accrue time for an absent export through start or stop notifications', () => {
  // Given no collection has been initialized
  const state = null;

  // When run-start and run-stop notifications arrive before state exists
  markBrooksMediaExportRunStarted(state, timestamp);
  const elapsed = stopBrooksMediaExportRunTimer(state, timestamp + 10_000);

  // Then runtime remains explicitly unavailable instead of inventing a duration
  assert.equal(elapsed, null);
  assert.equal(getBrooksMediaExportElapsedMs(state, timestamp + 10_000), null);
});

test('user sees no wall-clock duration invented for saved progress from before active timing existed', () => {
  // Given a supported old persisted export has progress timestamps but no active timing fields
  const state = {
    schemaVersion: 2, links: [courseUrl], index: 0, records: [], failures: [],
    running: false, stopped: true, startedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
  };

  // When that paused state is displayed and exported before resuming
  const status = formatBrooksMediaExportStatus({ state, now: timestamp });
  const payload = buildBrooksMediaExportPayload(state, exportedAt);

  // Then the known progress remains available while unknown runtime stays absent
  assert.equal(status, '已暂停 0/1 | 成功 0 | 失败 0');
  assert.equal(payload.elapsedMs, null);
  assert.equal(payload.elapsedSeconds, null);
  assert.equal(payload.elapsedText, '');
  assert.deepEqual(payload.missingIndexes, [0]);
  assert.equal(getBrooksMediaExportPrimaryLabel(state), '继续');
});

test('user begins measured runtime on resuming an old export and never counts repeated starts or stops twice', t => {
  // Given saved progress predates active timing and resumes at a controlled wall-clock instant
  t.mock.timers.enable({ apis: ['Date'], now: timestamp });
  const state = {
    schemaVersion: 2, links: [courseUrl], index: 0, records: [], failures: [], running: true, stopped: false,
    startedAt: '2026-09-01T00:00:00.000Z',
  };

  // When repeated notifications occur around one five-second active run
  markBrooksMediaExportRunStarted(state);
  t.mock.timers.setTime(timestamp + 2_000);
  markBrooksMediaExportRunStarted(state);
  const liveElapsed = getBrooksMediaExportElapsedMs(state);
  t.mock.timers.setTime(timestamp + 5_000);
  const firstStop = stopBrooksMediaExportRunTimer(state);
  t.mock.timers.setTime(timestamp + 60_000);
  const repeatedStop = stopBrooksMediaExportRunTimer(state);

  // Then repeated start preserves the first boundary and repeated stop preserves the accumulator
  assert.equal(liveElapsed, 2_000);
  assert.equal(firstStop, 5_000);
  assert.equal(repeatedStop, 5_000);
  assert.equal(state.activeElapsedMs, 5_000);
  assert.equal(Object.hasOwn(state, 'activeRunStartedAt'), false);
  assert.equal(state.startedAt, '2026-09-01T00:00:00.000Z');
});

test('user never loses accumulated runtime when the system clock moves backward during a run', () => {
  // Given a collection already contains two seconds of completed active work
  const state = { running: true, activeElapsedMs: 2_000, activeRunStartedAt: exportedAt };

  // When both live display and pause see a clock earlier than this run started
  const liveElapsed = getBrooksMediaExportElapsedMs(state, timestamp - 1_000);
  const pausedElapsed = stopBrooksMediaExportRunTimer(state, timestamp - 1_000);

  // Then the clock correction adds zero duration and preserves earlier active work
  assert.equal(liveElapsed, 2_000);
  assert.equal(pausedElapsed, 2_000);
  assert.equal(state.activeElapsedMs, 2_000);
});

test('user sees duration rounded down consistently across seconds, minutes, and hours', () => {
  // Given export durations straddle human-readable unit boundaries
  const durations = [undefined, 0, 999, 59_999, 60_000, 61_999, 3_600_000, 3_661_999];

  // When the public formatter produces the UI and payload duration strings
  const labels = durations.map(formatBrooksMediaExportDuration);

  // Then absent values stay absent and each displayed duration rounds down to whole seconds
  assert.deepEqual(labels, ['', '0s', '0s', '59s', '1m00s', '1m01s', '1h00m00s', '1h01m01s']);
});

test('user can read numeric and ISO timestamps while invalid saved timestamps remain unavailable', () => {
  // Given timestamp values arrive from saved state or the runtime clock
  const inputs = [timestamp, exportedAt, '', null, 'not a timestamp'];

  // When the exported parser interprets those boundary values
  const values = inputs.map(parseBrooksMediaExportTime);

  // Then equivalent valid timestamps agree and invalid values never become a guessed instant
  assert.deepEqual(values, [timestamp, timestamp, null, null, null]);
});

test('user keeps readable page labels for root URLs and compact non-URL diagnostics', () => {
  // Given a status consumer has a host root, a short diagnostic label, and oversized text
  const root = 'https://www.brookstradingcourse.com/';
  const label = 'Pending course';

  // When page and plain-text labels are formatted for the compact status panel
  const result = [getBrooksMediaExportPageLabel(root), getBrooksMediaExportPageLabel(label), truncateBrooksMediaExportText('Long label', 5)];

  // Then short identities remain intact and truncation reserves its final ellipsis
  assert.deepEqual(result, [root, label, 'Long…']);
});
