import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dataDir, loadDefaults, loadCalibration, effectiveParams, calibrationStatus, emptyCalibration,
} from '../scripts/lib/config.mjs';
import { testParams, near, tmp } from './helpers.mjs';

test('dataDir prefers AGENT_ETA_HOME, then CLAUDE_PLUGIN_DATA', () => {
  const a = tmp();
  const b = tmp();
  assert.equal(dataDir({ AGENT_ETA_HOME: a, CLAUDE_PLUGIN_DATA: b }), a);
  assert.equal(dataDir({ CLAUDE_PLUGIN_DATA: b }), b);
});

test('shipped defaults.json has every required key', () => {
  const d = loadDefaults();
  for (const key of Object.keys(testParams())) assert.ok(key in d, `missing ${key}`);
});

test('missing calibration file gives empty calibration and no warning', () => {
  const r = loadCalibration(tmp());
  assert.deepEqual(r.calibration, emptyCalibration());
  assert.equal(r.warning, null);
});

test('corrupt calibration file gives empty calibration and a warning', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'calibration.json'), '{not json');
  const r = loadCalibration(dir);
  assert.deepEqual(r.calibration, emptyCalibration());
  assert.match(r.warning, /corrupt/);
});

test('corrections are ignored below minConfirmed', () => {
  const cal = { ...emptyCalibration(), confirmed: 2, cells: { 'integration.M': 2 }, replyDelay: 9 };
  const p = effectiveParams(testParams(), cal);
  assert.equal(p.base.integration.M, 10);
  assert.equal(p.replyDelay, 4);
});

test('corrections apply at minConfirmed', () => {
  const cal = { confirmed: 3, cells: { 'integration.M': 1.5 }, workflow: { 'subagent-driven': 0.5 }, replyDelay: 9 };
  const p = effectiveParams(testParams(), cal);
  near(p.base.integration.M, 15);
  near(p.base.integration.S, 5);
  near(p.workflowFactor['subagent-driven'], 0.9);
  assert.equal(p.replyDelay, 9);
});

test('effectiveParams does not mutate the defaults object', () => {
  const d = testParams();
  effectiveParams(d, { confirmed: 5, cells: { 'judgment.L': 2 }, workflow: {}, replyDelay: null });
  assert.equal(d.base.judgment.L, 30);
});

test('calibrationStatus wording', () => {
  const p = testParams();
  assert.equal(calibrationStatus(p, { confirmed: 1 }), 'default numbers (2 more confirmed estimates until personal)');
  assert.equal(calibrationStatus(p, { confirmed: 2 }), 'default numbers (1 more confirmed estimate until personal)');
  assert.equal(calibrationStatus(p, { confirmed: 4 }), 'personal numbers (from 4 confirmed estimates)');
});
