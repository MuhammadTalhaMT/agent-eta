#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, loadDefaults, loadCalibration, effectiveParams, calibrationStatus } from './lib/config.mjs';
import { estimate } from './estimate.mjs';
import { speedups } from './speedups.mjs';
import { formatReport, formatDuration } from './lib/format.mjs';
import { parsePlan } from './lib/plan.mjs';
import { projectsRoot } from './lib/transcripts.mjs';
import { readRecords, updateRecords, appendRecord, newId, logError } from './lib/store.mjs';
import { runMeasure } from './measure.mjs';

const USAGE = `Usage:
  cli.mjs plan <plan.md>
  cli.mjs estimate <tags.json> [--plan <plan.md>] [--project <dir>]
  cli.mjs done [estimate-id] [--project <dir>]
  cli.mjs stats
  cli.mjs measure`;

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) i++;
    else out.push(args[i]);
  }
  return out;
}

class InputError extends Error {}

const percent = (actual, predicted) => {
  if (!Number.isFinite(predicted) || predicted === 0 || !Number.isFinite(actual)) return '—';
  const p = Math.round(((actual - predicted) / predicted) * 100);
  return `${p > 0 ? '+' : ''}${p}%`;
};

const sameProject = (a, b) => (process.platform === 'win32' ? a?.toLowerCase() === b?.toLowerCase() : a === b);

function requireArg(value, what) {
  if (!value) throw new InputError(`Missing argument: ${what}`);
  return value;
}

function readInput(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    throw new InputError(`Cannot read ${what} file: ${path} (${e.code ?? e.message})`);
  }
}

const RERUN_MS = 10 * 60000;
const taskTitles = r => JSON.stringify((Array.isArray(r.input?.tasks) ? r.input.tasks : []).map(t => t?.title));

// A second `estimate` for the same work in the same session (a retry, or re-tagging) replaces the
// open record instead of adding one, so learning doesn't count the build twice.
function findRerun(records, rec, now) {
  if (!rec.sessionId) return null;
  return [...records].reverse().find(r => {
    const age = now - Date.parse(r.startedAt);
    return r.status === 'open'
      && r.sessionId === rec.sessionId
      && sameProject(r.project, rec.project)
      && age >= 0 && age < RERUN_MS
      && r.mode === rec.mode
      && (rec.mode === 'precise' ? sameProject(r.planPath, rec.planPath) : taskTitles(r) === taskTitles(rec));
  }) ?? null;
}

// Plan tasks whose checkboxes are all ticked are already built; a mid-plan estimate covers the rest.
function tickedTaskIds(planFile) {
  try {
    return parsePlan(readFileSync(planFile, 'utf8')).tasks.filter(t => t.steps > 0 && t.done === t.steps).map(t => t.id);
  } catch {
    return [];
  }
}

function withoutTasks(input, ids) {
  return {
    ...input,
    tasks: input.tasks
      .filter(t => !ids.includes(t?.id))
      .map(t => (Array.isArray(t?.depends_on) ? { ...t, depends_on: t.depends_on.filter(d => !ids.includes(d)) } : t)),
  };
}

function safeMeasure(ctx) {
  try {
    return ctx.measure(ctx);
  } catch (e) {
    logError(ctx.dir, `measure failed: ${e.stack || e}`);
    return null;
  }
}

export function main(argv, {
  env = process.env,
  cwd = process.cwd(),
  now = Date.now(),
  out = s => process.stdout.write(`${s}\n`),
  err = s => process.stderr.write(`${s}\n`),
  measure = runMeasure, // test seam
} = {}) {
  try {
    return run(argv, { env, cwd, now, out, err, measure });
  } catch (e) {
    if (e instanceof InputError) {
      err(e.message);
      return 2;
    }
    err(`agent-eta: ${e?.message ?? e}`);
    try {
      logError(dataDir(env), `cli failed: ${e?.stack || e}`);
    } catch {
      // data dir unavailable
    }
    return 1;
  }
}

function run(argv, { env, cwd, now, out, err, measure }) {
  const [cmd, ...args] = argv;
  const pos = positional(args);
  const dir = dataDir(env);
  const defaults = loadDefaults();
  const root = projectsRoot(env);
  const project = resolve(option(args, '--project') ?? cwd);
  const ctx = { dir, defaults, now, root, measure };

  switch (cmd) {
    case 'plan': {
      out(JSON.stringify(parsePlan(readInput(requireArg(pos[0], 'plan file'), 'plan')), null, 2));
      return 0;
    }

    case 'estimate': {
      safeMeasure(ctx);
      const tagsPath = requireArg(pos[0], 'tags file');
      let input;
      try {
        input = JSON.parse(readInput(tagsPath, 'tags'));
      } catch (e) {
        if (e instanceof InputError) throw e;
        throw new InputError(`Invalid JSON in tags file ${tagsPath}: ${e.message}`);
      }
      let planPath = option(args, '--plan');
      if (planPath && !existsSync(resolve(project, planPath))) {
        err(`Plan file not found: ${planPath}. Saving as a rough estimate.`);
        planPath = undefined;
      }
      const ticked = planPath ? tickedTaskIds(resolve(project, planPath)) : [];
      const skipped = Array.isArray(input?.tasks) ? input.tasks.filter(t => ticked.includes(t?.id)).map(t => t.id) : [];
      if (skipped.length) {
        input = withoutTasks(input, skipped);
        if (!input.tasks.length) {
          err(`Every task in ${planPath} is already ticked; nothing left to estimate.`);
          return 2;
        }
      }
      const { calibration, warning } = loadCalibration(dir);
      const params = effectiveParams(defaults, calibration);
      let est;
      try {
        est = estimate(input, params);
      } catch (e) {
        err(e.message);
        return 2;
      }
      const calibrationActive = calibration.confirmed >= defaults.minConfirmed;
      const tips = speedups(input, params, est);
      const record = {
        id: newId(now),
        project,
        sessionId: env.CLAUDE_CODE_SESSION_ID ?? null,
        startedAt: new Date(now).toISOString(),
        mode: planPath ? 'precise' : 'rough',
        planPath: planPath ? resolve(project, planPath) : null,
        workflow: est.workflow,
        input,
        predicted: {
          agentMinutes: est.agentMinutes,
          userMinutes: est.userMinutes,
          wall: est.wall,
          low: est.low,
          high: est.high,
          perTask: est.tasks.map(({ id, title, kind, size, agent }) => ({ id, title, kind, size, agent })),
          applied: calibrationActive
            ? { cells: { ...calibration.cells }, workflow: calibration.workflow?.[est.workflow] ?? 1 }
            : { cells: {}, workflow: 1 },
        },
        ...(skipped.length ? { skippedTasks: skipped } : {}),
        status: 'open',
      };
      const earlier = findRerun(readRecords(dir), record, now);
      if (earlier) {
        record.id = earlier.id;
        record.startedAt = earlier.startedAt;
        updateRecords(dir, [record]);
      } else {
        appendRecord(dir, record);
      }
      out(formatReport(est, tips, calibrationStatus(defaults, calibration), warning));
      out('');
      if (skipped.length) {
        out(`Skipped task${skipped.length === 1 ? '' : 's'} ${skipped.join(', ')} (already ticked in the plan).`);
      }
      const saved = earlier ? `Estimate ${record.id} updated (replaces this session's earlier run).` : `Estimate ${record.id} saved.`;
      out(planPath
        ? `${saved} I'll notice when every plan checkbox is ticked, or run /agent-eta:eta-done.`
        : `${saved} Run /agent-eta:eta-done when this work is finished so the estimate can learn.`);
      return 0;
    }

    case 'done': {
      const records = readRecords(dir);
      const target = pos[0]
        ? records.find(r => r.id === pos[0] && r.status === 'open')
        : [...records].reverse().find(r => r.status === 'open' && sameProject(r.project, project));
      if (!target) {
        out('No open estimate for this project.');
        return 1;
      }
      target.doneAt = new Date(now).toISOString();
      target.doneSessionId = env.CLAUDE_CODE_SESSION_ID ?? null;
      updateRecords(dir, [target]);
      const result = safeMeasure(ctx);
      const r = result?.records.find(x => x.id === target.id);
      if (r?.status === 'confirmed' && r.predicted && r.actual) {
        out(`Estimate ${r.id} confirmed. Predicted ~${formatDuration(r.predicted.wall)}, actual ~${formatDuration(r.actual.wall)} (${percent(r.actual.wall, r.predicted.wall)}).`);
      } else if (r?.status === 'unconfirmed') {
        out(`Estimate ${r.id}: ${r.reason ?? 'could not be measured'} — not used for learning.`);
      } else {
        out(`Estimate ${target.id} couldn't be measured right now. It stays marked done and will be measured again on the next /agent-eta:eta.`);
      }
      return 0;
    }

    case 'stats': {
      const result = safeMeasure(ctx) ?? { records: readRecords(dir), calibration: loadCalibration(dir).calibration };
      const confirmed = result.records.filter(r => r.status === 'confirmed' && Number.isFinite(r.predicted?.wall) && Number.isFinite(r.actual?.wall)).slice(-10);
      const lines = [];
      if (!confirmed.length) {
        lines.push('No confirmed estimates yet. Run /agent-eta:eta-done when estimated work is finished.');
      } else {
        lines.push(`agent-eta — last ${confirmed.length} confirmed estimate${confirmed.length === 1 ? '' : 's'}`);
        for (const r of confirmed) {
          lines.push(`  ${r.id}  ${String(r.startedAt ?? '').slice(0, 10)}  predicted ${formatDuration(r.predicted.wall)}  actual ${formatDuration(r.actual.wall)}  ${percent(r.actual.wall, r.predicted.wall)}`);
        }
        const scored = confirmed.filter(r => r.predicted.wall > 0);
        const avg = scored.length ? scored.reduce((s, r) => s + (r.actual.wall - r.predicted.wall) / r.predicted.wall, 0) / scored.length : 0;
        const sign = Math.round(avg * 100);
        lines.push(`Average error: ${sign > 0 ? '+' : ''}${sign}% (${sign > 0 ? 'estimates run low' : sign < 0 ? 'estimates run high' : 'on target'})`);
      }
      const open = result.records.filter(r => r.status === 'open').length;
      const unconfirmed = result.records.filter(r => r.status === 'unconfirmed').length;
      lines.push(`Open: ${open} · Unconfirmed: ${unconfirmed}`);
      const cal = result.calibration;
      const finite = ([, v]) => Number.isFinite(v);
      const corr = [
        ...Object.entries(cal.cells ?? {}).filter(finite).map(([k, v]) => `${k} ×${v.toFixed(2)}`),
        ...Object.entries(cal.workflow ?? {}).filter(finite).map(([k, v]) => `workflow ${k} ×${v.toFixed(2)}`),
        ...(Number.isFinite(cal.replyDelay) ? [`reply delay ${cal.replyDelay.toFixed(1)} min`] : []),
      ];
      if (corr.length) lines.push(`Corrections: ${corr.join(', ')}`);
      lines.push(`Calibration: ${calibrationStatus(defaults, cal)}`);
      out(lines.join('\n'));
      return 0;
    }

    case 'measure': {
      const result = safeMeasure(ctx);
      out(result ? `Measured. ${result.records.filter(r => r.status === 'confirmed').length} confirmed estimates.` : 'Measure failed; see errors.log.');
      return result ? 0 : 1;
    }

    default:
      out(USAGE);
      return 1;
  }
}

function isEntry() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  process.exitCode = main(process.argv.slice(2));
}
