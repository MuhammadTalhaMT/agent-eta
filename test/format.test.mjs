import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatReport } from '../scripts/lib/format.mjs';

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(45.4), '45 min');
  assert.equal(formatDuration(59.6), '1h');
  assert.equal(formatDuration(65), '1h 05m');
  assert.equal(formatDuration(125), '2h 05m');
  assert.equal(formatDuration(-3), '0 min');
  assert.equal(formatDuration(NaN), '0 min');
  assert.equal(formatDuration(Infinity), '0 min');
});

const est = {
  low: 70, high: 110, agentMinutes: 50, userActiveMinutes: 25, replyDelayMinutes: 28,
  questions: 5, approvals: 2, manualTests: 1,
  risk: { id: 3, title: 'Stripe webhooks', extra: 30 },
};

test('report shows total, split, risk and calibration', () => {
  const r = formatReport(est, [], 'default numbers (3 more confirmed estimates until personal)');
  const lines = r.split('\n');
  assert.equal(lines[0], 'Total: 1h 10m – 1h 50m (wall clock)');
  assert.equal(lines[1], '  Agents working:   ~50 min   (you can walk away)');
  assert.equal(lines[2], '  You needed:       ~25 min   (5 questions, 2 approvals, 1 manual test)');
  assert.equal(lines[3], '  Waiting on you:   ~28 min   (Claude idle until you reply)');
  assert.equal(lines[4], '  Biggest risk:     Task 3 — Stripe webhooks (+30 min if it goes badly)');
  assert.match(r, /Calibration: default numbers/);
  assert.doesNotMatch(r, /Speed-ups/);
});

test('report lists speed-ups with total saving', () => {
  const tips = [
    { kind: 'parallel', saved: 15, text: 'Tasks 2 & 4 are independent → run them in parallel' },
    { kind: 'cheaper-model', saved: 0, text: 'Task 1 is mechanical → use a cheaper model' },
  ];
  const r = formatReport(est, tips, 'x');
  assert.match(r, /Speed-ups \(−15 min\):/);
  assert.match(r, /• Tasks 2 & 4 are independent → run them in parallel \(−15 min\)/);
  assert.match(r, /• Task 1 is mechanical → use a cheaper model$/m);
});

test('report with no checkpoints and a warning', () => {
  const r = formatReport({ ...est, questions: 0, approvals: 0, manualTests: 0 }, [], 'x', 'calibration.json is corrupt');
  assert.match(r, /\(no checkpoints\)/);
  assert.match(r, /Warning: calibration.json is corrupt/);
});

test('speed-up total is the sum of rounded tip savings', () => {
  const tips = [
    { kind: 'parallel', saved: 7.4, text: 'A' },
    { kind: 'frontload', saved: 7.4, text: 'B' },
  ];
  const r = formatReport(est, tips, 'x');
  assert.match(r, /Speed-ups \(−14 min\):/);
  assert.equal(r.match(/\(−7 min\)/g).length, 2);
});
