import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
  writeFileSync(recordsPath(dir), records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
}

export function appendRecord(dir, record) {
  appendFileSync(recordsPath(dir), JSON.stringify(record) + '\n');
}

export function saveCalibration(dir, calibration) {
  writeFileSync(join(dir, 'calibration.json'), JSON.stringify(calibration, null, 2));
}

export function logError(dir, message) {
  appendFileSync(join(dir, 'errors.log'), `${new Date().toISOString()} ${message}\n`);
}

export const newId = (now = Date.now()) => `eta-${now.toString(36)}`;
