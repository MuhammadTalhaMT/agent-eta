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

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && typeof v.id === 'string' && typeof v.status === 'string';

export function readRecords(dir) {
  const p = recordsPath(dir);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .flatMap(l => {
      try {
        const v = JSON.parse(l);
        return isRecord(v) ? [v] : [];
      } catch {
        return [];
      }
    });
}

export function writeRecords(dir, records) {
  atomicWrite(recordsPath(dir), records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
}

// Re-read the file and merge by id just before writing, so a record appended (or changed)
// by another session since our first read isn't lost. `changed` records win; unknown ids are appended.
export function updateRecords(dir, changed) {
  mkdirSync(dir, { recursive: true });
  const byId = new Map(changed.map(r => [r.id, r]));
  const merged = readRecords(dir).map(r => {
    if (!byId.has(r.id)) return r;
    const mine = byId.get(r.id);
    byId.delete(r.id);
    return mine;
  });
  writeRecords(dir, [...merged, ...byId.values()]);
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
