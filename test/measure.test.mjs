import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { nudge, findDoneAt, matchTasks, applyLearning, runMeasure } from '../scripts/measure.mjs';
import { encodeProjectPath, measureWindow } from '../scripts/lib/transcripts.mjs';
import { appendRecord, readRecords } from '../scripts/lib/store.mjs';
import { loadCalibration, emptyCalibration } from '../scripts/lib/config.mjs';
import { testParams, near, tmp } from './helpers.mjs';

const T = hhmm => `2026-01-01T${hhmm}:00.000Z`;
const assistant = hhmm => JSON.stringify({ type: 'assistant', timestamp: T(hhmm), message: { content: [{ type: 'text', text: 'ok' }] } });
const human = hhmm => JSON.stringify({ type: 'user', timestamp: T(hhmm), message: { content: 'go on' } });
const PROJECT = 'C:\\fake\\proj';

const record = (extra = {}) => ({
  id: 'eta-1',
  project: PROJECT,
  startedAt: T('10:00'),
  mode: 'rough',
  planPath: null,
  workflow: 'inline',
  predicted: { agentMinutes: 10, userMinutes: 2, wall: 12, low: 10, high: 20, perTask: [] },
  status: 'open',
  ...extra,
});

function transcripts(root) {
  const dir = join(root, encodeProjectPath(PROJECT));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 's.jsonl'), [assistant('10:01'), human('10:05'), assistant('10:06'), assistant('10:20')].join('\n'));
}

test('nudge moves 30% toward the ratio, clamped', () => {
  near(nudge(1, 2, testParams()), 1.3);
  near(nudge(1, 5, testParams()), 1.3);
  near(nudge(1, 0.1, testParams()), 0.85);
  near(nudge(4, 1, testParams()), 4);
});

test('findDoneAt: explicit done, finished plan, expiry, still open', () => {
  const p = testParams();
  const now = Date.parse(T('12:00'));
  assert.deepEqual(findDoneAt(record({ doneAt: T('10:30') }), now, p), { status: 'done', doneAt: Date.parse(T('10:30')) });

  const plan = join(tmp(), 'plan.md');
  writeFileSync(plan, '### Task 1: A\n\n- [x] step\n');
  const d = findDoneAt(record({ planPath: plan }), now, p);
  assert.equal(d.status, 'done');
  assert.equal(typeof d.doneAt, 'number');

  writeFileSync(plan, '### Task 1: A\n\n- [ ] step\n');
  assert.equal(findDoneAt(record({ planPath: plan }), now, p).status, 'open');

  const later = Date.parse(T('10:00')) + 15 * 86400000;
  assert.equal(findDoneAt(record(), later, p).status, 'expired');
});

test('matchTasks matches by "Task N" word or title, summing runs', () => {
  const perTask = [{ id: 2, title: 'Plan parser', kind: 'integration', size: 'M', agent: 10 }];
  const runs = [
    { description: 'Implement Task 2: plan parser', minutes: 12 },
    { description: 'Review task 2', minutes: 3 },
    { description: 'Task 12 thing', minutes: 5 },
    { description: 'fix PLAN PARSER edge case', minutes: 1 },
  ];
  const m = matchTasks(perTask, runs);
  assert.equal(m.length, 1);
  near(m[0].actual, 16);
});

test('applyLearning: matched tasks update cells, else workflow; reply delay; count', () => {
  const p = testParams();
  const actual = { agentMinutes: 15, userMinutes: 24, humanGaps: 3, humanGapMedian: 8 };
  const matched = [{ kind: 'integration', size: 'M', agent: 10, actual: 20 }];
  const a = applyLearning(emptyCalibration(), record(), actual, matched, p);
  near(a.cells['integration.M'], 1.3);
  assert.equal(a.workflow.inline, undefined);
  near(a.replyDelay, 5.2);
  assert.equal(a.confirmed, 1);

  const b = applyLearning(emptyCalibration(), record(), actual, [], p);
  near(b.workflow.inline, 1.15);
});

test('applyLearning skips reply delay with fewer than 3 human gaps', () => {
  const actual = { agentMinutes: 15, userMinutes: 16, humanGaps: 2, humanGapMedian: 8 };
  const a = applyLearning(emptyCalibration(), record(), actual, [], testParams());
  assert.equal(a.replyDelay, null);
});

test('applyLearning converges toward the true factor without overshooting (applied = 1)', () => {
  const p = testParams();
  const actual = { agentMinutes: 15, userMinutes: 0, humanGaps: 0, humanGapMedian: null };
  const matched = [{ kind: 'integration', size: 'M', agent: 10, actual: 20 }];
  let cal = emptyCalibration();
  const seen = [];
  for (let i = 0; i < 3; i++) {
    cal = applyLearning(cal, record({ predicted: { ...record().predicted, applied: { cells: {}, workflow: 1 } } }), actual, matched, p);
    seen.push(cal.cells['integration.M']);
  }
  near(seen[0], 1.3);
  near(seen[1], 1.51);
  near(seen[2], 1.657);
  assert.ok(seen.every(v => v < 2));
});

test('applyLearning scales the target by the multiplier that was applied', () => {
  const p = testParams();
  const rec = record({ predicted: { ...record().predicted, applied: { cells: { 'integration.M': 1.5 }, workflow: 1 } } });
  const cal = emptyCalibration();
  cal.cells['integration.M'] = 1.5;
  const matched = [{ kind: 'integration', size: 'M', agent: 15, actual: 20 }];
  const out = applyLearning(cal, rec, { agentMinutes: 1, userMinutes: 0, humanGaps: 0, humanGapMedian: null }, matched, p);
  near(out.cells['integration.M'], 1.5 + 0.3 * (20 / 15 * 1.5 - 1.5));
});

test('applyLearning averages ratios of tasks sharing a cell', () => {
  const matched = [
    { kind: 'integration', size: 'M', agent: 10, actual: 20 },
    { kind: 'integration', size: 'M', agent: 10, actual: 10 },
  ];
  const out = applyLearning(emptyCalibration(), record(), { agentMinutes: 1, userMinutes: 0, humanGaps: 0, humanGapMedian: null }, matched, testParams());
  near(out.cells['integration.M'], 1.15);
});

test('runMeasure confirms a done estimate and saves calibration', () => {
  const dir = tmp();
  const root = tmp();
  transcripts(root);
  appendRecord(dir, record({ doneAt: T('10:30') }));
  runMeasure({ dir, defaults: testParams(), now: Date.parse(T('12:00')), root });
  const [r] = readRecords(dir);
  assert.equal(r.status, 'confirmed');
  near(r.actual.agentMinutes, 15);
  near(r.actual.userMinutes, 4);
  near(r.actual.wall, 19);
  const { calibration } = loadCalibration(dir);
  assert.equal(calibration.confirmed, 1);
  near(calibration.workflow.inline, 1.15);
});

test('runMeasure: expired → unconfirmed; done without transcripts → unconfirmed + errors.log', () => {
  const dir = tmp();
  const root = tmp();
  appendRecord(dir, record({ id: 'old' }));
  appendRecord(dir, record({ id: 'empty', doneAt: T('10:30') }));
  runMeasure({ dir, defaults: testParams(), now: Date.parse(T('10:00')) + 15 * 86400000, root });
  const byId = Object.fromEntries(readRecords(dir).map(r => [r.id, r]));
  assert.equal(byId.old.status, 'unconfirmed');
  assert.equal(byId.empty.status, 'unconfirmed');
  assert.ok(existsSync(join(dir, 'errors.log')));
  assert.equal(loadCalibration(dir).calibration.confirmed, 0);
});

test("runMeasure only measures the estimate's own session when sessionId is set", () => {
  const dir = tmp();
  const root = tmp();
  transcripts(root); // writes session file s.jsonl
  appendRecord(dir, record({ id: 'mine', sessionId: 's', doneAt: T('10:30') }));
  appendRecord(dir, record({ id: 'other', sessionId: 'not-this-one', doneAt: T('10:30') }));
  runMeasure({ dir, defaults: testParams(), now: Date.parse(T('12:00')), root });
  const byId = Object.fromEntries(readRecords(dir).map(r => [r.id, r]));
  assert.equal(byId.mine.status, 'confirmed');
  assert.equal(byId.other.status, 'unconfirmed');
});

test('runMeasure leaves open estimates alone', () => {
  const dir = tmp();
  appendRecord(dir, record());
  runMeasure({ dir, defaults: testParams(), now: Date.parse(T('12:00')), root: tmp() });
  assert.equal(readRecords(dir)[0].status, 'open');
  assert.equal(existsSync(join(dir, 'calibration.json')), false);
});

test('runMeasure: one bad record does not stop the good one', () => {
  const dir = tmp();
  const root = tmp();
  transcripts(root);
  appendRecord(dir, { id: 'bad', project: PROJECT, startedAt: T('10:00'), mode: 'rough', workflow: 'inline', status: 'open', doneAt: T('10:30') });
  appendRecord(dir, record({ id: 'good', doneAt: T('10:30') }));
  runMeasure({ dir, defaults: testParams(), now: Date.parse(T('12:00')), root });
  const byId = Object.fromEntries(readRecords(dir).map(r => [r.id, r]));
  assert.equal(byId.good.status, 'confirmed');
  assert.equal(byId.bad.status, 'unconfirmed');
  assert.equal(byId.bad.reason, 'record unreadable');
  assert.equal(loadCalibration(dir).calibration.confirmed, 1);
});

test('findDoneAt: unreadable plan counts as not done; plan time capped at now', () => {
  const p = testParams();
  const plan = join(tmp(), 'plan.md');
  writeFileSync(plan, '### Task 1: A\n\n- [x] step\n');
  const early = Date.parse(T('10:00'));
  const d = findDoneAt(record({ planPath: plan }), early, p);
  assert.equal(d.status, 'done');
  assert.ok(d.doneAt <= early);
  assert.equal(findDoneAt(record({ planPath: tmp() }), early, p).status, 'open');
});

test('runMeasure keeps a record appended by another session while it was measuring', () => {
  const dir = tmp();
  const root = tmp();
  transcripts(root);
  appendRecord(dir, record({ id: 'mine', doneAt: T('10:30') }));
  const slowWindow = (...args) => {
    appendRecord(dir, record({ id: 'appended-meanwhile' }));
    return measureWindow(...args);
  };
  runMeasure({ dir, defaults: testParams(), now: Date.parse(T('12:00')), root, window: slowWindow });
  const byId = Object.fromEntries(readRecords(dir).map(r => [r.id, r]));
  assert.equal(byId.mine.status, 'confirmed');
  assert.equal(byId['appended-meanwhile']?.status, 'open');
});
