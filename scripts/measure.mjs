import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlan } from './lib/plan.mjs';
import { projectsRoot, encodeProjectPath, measureWindow, subagentRuns } from './lib/transcripts.mjs';
import { readRecords, writeRecords, saveCalibration, logError } from './lib/store.mjs';
import { loadCalibration } from './lib/config.mjs';

export function nudge(old, ratio, params) {
  const [lo, hi] = params.clamp;
  const r = Math.min(hi, Math.max(lo, ratio));
  return old + params.learningRate * (r * old - old);
}

export function findDoneAt(record, now, params) {
  if (record.doneAt) return { status: 'done', doneAt: Date.parse(record.doneAt) };
  if (record.planPath && existsSync(record.planPath)) {
    const plan = parsePlan(readFileSync(record.planPath, 'utf8'));
    if (plan.allChecked) return { status: 'done', doneAt: statSync(record.planPath).mtimeMs };
  }
  if (now - Date.parse(record.startedAt) > params.expiryDays * 86400000) return { status: 'expired' };
  return { status: 'open' };
}

export function matchTasks(perTask, runs) {
  const out = [];
  for (const t of perTask) {
    const byNumber = new RegExp(`\\btask\\s*#?${t.id}\\b`, 'i');
    const title = t.title.toLowerCase();
    const hits = runs.filter(r => byNumber.test(r.description) || r.description.toLowerCase().includes(title));
    if (hits.length) out.push({ ...t, actual: hits.reduce((s, r) => s + r.minutes, 0) });
  }
  return out;
}

export function applyLearning(calibration, record, actual, matched, params) {
  const cal = structuredClone(calibration);
  if (matched.length) {
    for (const t of matched) {
      const key = `${t.kind}.${t.size}`;
      cal.cells[key] = nudge(cal.cells[key] ?? 1, t.actual / t.agent, params);
    }
  } else if (record.predicted.agentMinutes > 0) {
    const w = record.workflow;
    cal.workflow[w] = nudge(cal.workflow[w] ?? 1, actual.agentMinutes / record.predicted.agentMinutes, params);
  }
  if (actual.humanGaps > 0) {
    const old = cal.replyDelay ?? params.replyDelay;
    cal.replyDelay = nudge(old, actual.userMinutes / actual.humanGaps / old, params);
  }
  cal.confirmed += 1;
  return cal;
}

export function runMeasure({ dir, defaults, now = Date.now(), root = projectsRoot() }) {
  const records = readRecords(dir);
  let { calibration } = loadCalibration(dir);
  let changed = false;

  for (const r of records) {
    if (r.status !== 'open') continue;
    const d = findDoneAt(r, now, defaults);
    if (d.status === 'open') continue;
    changed = true;

    if (d.status === 'expired') {
      r.status = 'unconfirmed';
      r.reason = `no done signal within ${defaults.expiryDays} days`;
      continue;
    }

    const projectDir = join(root, encodeProjectPath(r.project));
    const startMs = Date.parse(r.startedAt);
    r.doneAt = new Date(d.doneAt).toISOString();
    const sessionId = r.sessionId ?? null;
    const actual = measureWindow(projectDir, startMs, d.doneAt, defaults.breakMinutes, sessionId);
    if (actual.entries < 2) {
      r.status = 'unconfirmed';
      r.reason = 'no transcript activity found';
      logError(dir, `${r.id}: no transcript activity in ${projectDir}`);
      continue;
    }

    const matched = r.mode === 'precise'
      ? matchTasks(r.predicted.perTask, subagentRuns(projectDir, startMs, d.doneAt, sessionId))
      : [];
    r.status = 'confirmed';
    r.actual = {
      agentMinutes: actual.agentMinutes,
      userMinutes: actual.userMinutes,
      wall: actual.agentMinutes + actual.userMinutes,
      matchedTasks: matched.length,
    };
    calibration = applyLearning(calibration, r, actual, matched, defaults);
  }

  if (changed) {
    writeRecords(dir, records);
    saveCalibration(dir, calibration);
  }
  return { records, calibration };
}
