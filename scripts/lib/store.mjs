import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

function atomicWrite(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, path);
  } catch (err) {
    if (err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
    renameSync(tmp, path);
  }
}

export const recordsPath = dir => join(dir, 'estimates.jsonl');

export function readRecords(dir) {
  const p = recordsPath(dir);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .flatMap(l => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

export function writeRecords(dir, records) {
  atomicWrite(recordsPath(dir), records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
}

export function appendRecord(dir, record) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(recordsPath(dir), JSON.stringify(record) + '\n');
}

export function saveCalibration(dir, calibration) {
  mkdirSync(dir, { recursive: true });
  atomicWrite(join(dir, 'calibration.json'), JSON.stringify(calibration, null, 2));
}

export function logError(dir, message) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'errors.log'), `${new Date().toISOString()} ${message}\n`);
}

export const newId = (now = Date.now()) => `eta-${now.toString(36)}`;
