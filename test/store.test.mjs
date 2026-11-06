import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  readRecords, writeRecords, appendRecord, saveCalibration, logError, newId, recordsPath,
} from '../scripts/lib/store.mjs';
import { tmp } from './helpers.mjs';

test('append then read records', () => {
  const dir = tmp();
  assert.deepEqual(readRecords(dir), []);
  appendRecord(dir, { id: 'a' });
  appendRecord(dir, { id: 'b' });
  assert.deepEqual(readRecords(dir).map(r => r.id), ['a', 'b']);
});

test('writeRecords replaces the file; broken lines are skipped on read', () => {
  const dir = tmp();
  writeFileSync(recordsPath(dir), '{"id":"x"}\n{oops\n');
  assert.deepEqual(readRecords(dir).map(r => r.id), ['x']);
  writeRecords(dir, [{ id: 'y' }]);
  assert.deepEqual(readRecords(dir).map(r => r.id), ['y']);
});

test('saveCalibration and logError write files', () => {
  const dir = tmp();
  saveCalibration(dir, { confirmed: 1 });
  assert.equal(JSON.parse(readFileSync(join(dir, 'calibration.json'), 'utf8')).confirmed, 1);
  logError(dir, 'boom');
  assert.match(readFileSync(join(dir, 'errors.log'), 'utf8'), /boom/);
});

test('newId is stable for a given time', () => {
  assert.equal(newId(36), 'eta-10');
});

test('writeRecords and saveCalibration leave no tmp files', () => {
  const dir = tmp();
  writeRecords(dir, [{ id: 'a' }]);
  saveCalibration(dir, { confirmed: 1 });
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
});

test('logError, appendRecord and saveCalibration create a missing dir', () => {
  const base = tmp();
  logError(join(base, 'a', 'b'), 'boom');
  assert.match(readFileSync(join(base, 'a', 'b', 'errors.log'), 'utf8'), /boom/);
  appendRecord(join(base, 'c'), { id: 'z' });
  assert.equal(readRecords(join(base, 'c'))[0].id, 'z');
  saveCalibration(join(base, 'd'), { confirmed: 2 });
  assert.equal(JSON.parse(readFileSync(join(base, 'd', 'calibration.json'), 'utf8')).confirmed, 2);
});
