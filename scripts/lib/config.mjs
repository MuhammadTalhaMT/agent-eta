import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULTS_PATH = join(HERE, '..', '..', 'data', 'defaults.json');

export function dataDir(env = process.env) {
  const dir = env.AGENT_ETA_HOME || env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude', 'agent-eta');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadDefaults(path = DEFAULTS_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function emptyCalibration() {
  return { confirmed: 0, cells: {}, workflow: {}, replyDelay: null };
}

export function loadCalibration(dir) {
  let text;
  try {
    text = readFileSync(join(dir, 'calibration.json'), 'utf8');
  } catch {
    return { calibration: emptyCalibration(), warning: null };
  }
  try {
    return { calibration: { ...emptyCalibration(), ...JSON.parse(text) }, warning: null };
  } catch {
    return { calibration: emptyCalibration(), warning: 'calibration.json is corrupt; using default numbers' };
  }
}

export function effectiveParams(defaults, calibration) {
  const p = structuredClone(defaults);
  if (calibration.confirmed < defaults.minConfirmed) return p;
  for (const [kind, sizes] of Object.entries(p.base)) {
    for (const size of Object.keys(sizes)) {
      sizes[size] *= calibration.cells[`${kind}.${size}`] ?? 1;
    }
  }
  for (const w of Object.keys(p.workflowFactor)) {
    p.workflowFactor[w] *= calibration.workflow[w] ?? 1;
  }
  if (calibration.replyDelay != null) p.replyDelay = calibration.replyDelay;
  return p;
}

export function calibrationStatus(defaults, calibration) {
  const left = defaults.minConfirmed - calibration.confirmed;
  if (left > 0) {
    return `default numbers (${left} more confirmed estimate${left === 1 ? '' : 's'} until personal)`;
  }
  return `personal numbers (from ${calibration.confirmed} confirmed estimates)`;
}
