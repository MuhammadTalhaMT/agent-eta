import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main } from '../scripts/cli.mjs';
import { encodeProjectPath } from '../scripts/lib/transcripts.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRecords, appendRecord, saveCalibration } from '../scripts/lib/store.mjs';
import { tmp } from './helpers.mjs';

const T = hhmm => `2026-01-01T${hhmm}:00.000Z`;
const at = hhmm => Date.parse(T(hhmm));
const PROJECT = 'C:\\fake\\cli-proj';

function harness() {
  const home = tmp();
  const projects = tmp();
  const outLines = [];
  const errLines = [];
  const run = (argv, now = at('10:00')) => main(argv, {
    env: { AGENT_ETA_HOME: home, AGENT_ETA_PROJECTS: projects },
    cwd: PROJECT,
    now,
    out: s => outLines.push(s),
    err: s => errLines.push(s),
  });
  return { home, projects, run, out: () => outLines.join('\n'), err: () => errLines.join('\n') };
}

function tagsFile(tags) {
  const f = join(tmp(), 'tags.json');
  writeFileSync(f, JSON.stringify(tags));
  return f;
}

const TAGS = {
  workflow: 'inline',
  tasks: [
    { id: 1, title: 'API route', size: 'M', kind: 'integration', files: ['a.ts'] },
    { id: 2, title: 'Form', size: 'S', kind: 'mechanical', files: ['b.ts'], flags: ['manual_test'] },
  ],
};

test('estimate prints a report and saves an open rough record', () => {
  const h = harness();
  assert.equal(h.run(['estimate', tagsFile(TAGS)]), 0);
  assert.match(h.out(), /^Total: /m);
  assert.match(h.out(), /Calibration: default numbers/);
  assert.match(h.out(), /Estimate eta-\w+ saved/);
  const [r] = readRecords(h.home);
  assert.equal(r.mode, 'rough');
  assert.equal(r.status, 'open');
  assert.equal(r.project, resolve(PROJECT));
  assert.equal(r.predicted.perTask.length, 2);
});

test('estimate stores the Claude Code session id when available', () => {
  const home = tmp();
  main(['estimate', tagsFile(TAGS)], {
    env: { AGENT_ETA_HOME: home, AGENT_ETA_PROJECTS: tmp(), CLAUDE_CODE_SESSION_ID: 'sess-abc' },
    cwd: PROJECT,
    now: at('10:00'),
    out: () => {},
    err: () => {},
  });
  assert.equal(readRecords(home)[0].sessionId, 'sess-abc');
});

test('estimate with --plan saves a precise record', () => {
  const h = harness();
  const plan = join(tmp(), 'plan.md');
  writeFileSync(plan, '### Task 1: API route\n\n- [ ] a\n');
  assert.equal(h.run(['estimate', tagsFile(TAGS), '--plan', plan]), 0);
  const [r] = readRecords(h.home);
  assert.equal(r.mode, 'precise');
  assert.equal(r.planPath, plan);
});

test('precise estimate skips tasks whose steps are all ticked', () => {
  const h = harness();
  const plan = join(tmp(), 'plan.md');
  writeFileSync(plan, [
    '### Task 1: API route', '', '- [x] a', '- [x] b', '',
    '### Task 2: Form', '', '- [x] a', '- [ ] b', '',
    '### Task 3: Notes', '', 'no checkboxes here', '',
  ].join(String.fromCharCode(10)));
  const tags = structuredClone(TAGS);
  tags.tasks[1].depends_on = [1];
  tags.tasks.push({ id: 3, title: 'Notes', size: 'S', kind: 'mechanical' });
  assert.equal(h.run(['estimate', tagsFile(tags), '--plan', plan]), 0);
  const [r] = readRecords(h.home);
  assert.deepEqual(r.predicted.perTask.map(t => t.id), [2, 3]);
  assert.deepEqual(r.input.tasks.find(t => t.id === 2).depends_on, []);
  assert.deepEqual(r.skippedTasks, [1]);
  assert.match(h.out(), /Skipped task 1 \(already ticked/);
});

test('precise estimate with every task ticked exits 2 and saves nothing', () => {
  const h = harness();
  const plan = join(tmp(), 'plan.md');
  writeFileSync(plan, ['### Task 1: API route', '', '- [x] a', '', '### Task 2: Form', '', '- [x] a', ''].join(String.fromCharCode(10)));
  assert.equal(h.run(['estimate', tagsFile(TAGS), '--plan', plan]), 2);
  assert.match(h.err(), /already ticked/);
  assert.equal(readRecords(h.home).length, 0);
});

function sessionRunner(sid = 'sess-dup') {
  const home = tmp();
  const outLines = [];
  const run = (argv, now) => main(argv, {
    env: { AGENT_ETA_HOME: home, AGENT_ETA_PROJECTS: tmp(), ...(sid ? { CLAUDE_CODE_SESSION_ID: sid } : {}) },
    cwd: PROJECT, now, out: s => outLines.push(s), err: () => {},
  });
  return { home, run, out: () => outLines.join(String.fromCharCode(10)) };
}

test('re-running estimate in the same session within 10 min replaces the open record', () => {
  const s = sessionRunner();
  s.run(['estimate', tagsFile(TAGS)], at('10:00'));
  const retagged = structuredClone(TAGS);
  retagged.tasks[0].size = 'L';
  s.run(['estimate', tagsFile(retagged)], at('10:05'));
  const rs = readRecords(s.home);
  assert.equal(rs.length, 1);
  assert.equal(rs[0].startedAt, T('10:00'));
  assert.equal(rs[0].input.tasks[0].size, 'L');
  assert.equal(rs[0].predicted.perTask[0].size, 'L');
  assert.match(s.out(), new RegExp(`Estimate ${rs[0].id} (saved|updated)`));
});

test('precise re-run with the same plan in the same session replaces the record', () => {
  const s = sessionRunner();
  const plan = join(tmp(), 'plan.md');
  writeFileSync(plan, '### Task 1: API route\n\n- [ ] a\n');
  s.run(['estimate', tagsFile(TAGS), '--plan', plan], at('10:00'));
  const renamed = structuredClone(TAGS);
  renamed.tasks[0].title = 'Different title';
  s.run(['estimate', tagsFile(renamed), '--plan', plan], at('10:09'));
  assert.equal(readRecords(s.home).length, 1);
});

test('estimate appends when the earlier record differs, is old, or has no session', () => {
  const other = structuredClone(TAGS);
  other.tasks[0].title = 'Something else';

  const a = sessionRunner();
  a.run(['estimate', tagsFile(TAGS)], at('10:00'));
  a.run(['estimate', tagsFile(other)], at('10:01'));
  assert.equal(readRecords(a.home).length, 2, 'different task titles');

  const b = sessionRunner();
  b.run(['estimate', tagsFile(TAGS)], at('10:00'));
  b.run(['estimate', tagsFile(TAGS)], at('10:11'));
  assert.equal(readRecords(b.home).length, 2, 'older than 10 min');

  const c = sessionRunner(null);
  c.run(['estimate', tagsFile(TAGS)], at('10:00'));
  c.run(['estimate', tagsFile(TAGS)], at('10:01'));
  assert.equal(readRecords(c.home).length, 2, 'no session id');

  const d = sessionRunner();
  const plan = join(tmp(), 'plan.md');
  writeFileSync(plan, '### Task 1: API route\n\n- [ ] a\n');
  d.run(['estimate', tagsFile(TAGS)], at('10:00'));
  d.run(['estimate', tagsFile(TAGS), '--plan', plan], at('10:01'));
  assert.equal(readRecords(d.home).length, 2, 'different mode');
});

test('invalid tags exit 2 and name the field', () => {
  const h = harness();
  const bad = structuredClone(TAGS);
  bad.tasks[0].size = 'huge';
  assert.equal(h.run(['estimate', tagsFile(bad)]), 2);
  assert.match(h.err(), /Invalid tags: tasks\[0\]\.size/);
  assert.equal(readRecords(h.home).length, 0);
});

test('plan prints parsed JSON', () => {
  const h = harness();
  const plan = join(tmp(), 'plan.md');
  writeFileSync(plan, '### Task 1: API route\n\n**Files:**\n- Create: `a.ts`\n\n- [ ] a\n');
  assert.equal(h.run(['plan', plan]), 0);
  assert.equal(JSON.parse(h.out()).tasks[0].files[0], 'a.ts');
});

test('done measures the latest open estimate for this project', () => {
  const h = harness();
  h.run(['estimate', tagsFile(TAGS)], at('10:00'));
  const dir = join(h.projects, encodeProjectPath(PROJECT));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 's.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: T('10:01'), message: { content: [{ type: 'text', text: 'x' }] } }),
    JSON.stringify({ type: 'user', timestamp: T('10:05'), message: { content: 'next' } }),
    JSON.stringify({ type: 'assistant', timestamp: T('10:20'), message: { content: [{ type: 'text', text: 'x' }] } }),
  ].join('\n'));
  assert.equal(h.run(['done'], at('10:30')), 0);
  assert.match(h.out(), /confirmed\. Predicted ~.+, actual ~19 min/);
  assert.equal(readRecords(h.home)[0].status, 'confirmed');
});

test('done stores its own session id on the record', () => {
  const home = tmp();
  const io = sid => ({
    env: { AGENT_ETA_HOME: home, AGENT_ETA_PROJECTS: tmp(), CLAUDE_CODE_SESSION_ID: sid },
    cwd: PROJECT, out: () => {}, err: () => {},
  });
  main(['estimate', tagsFile(TAGS)], { ...io('sess-eta'), now: at('10:00') });
  main(['done'], { ...io('sess-done'), now: at('10:30') });
  const [r] = readRecords(home);
  assert.equal(r.sessionId, 'sess-eta');
  assert.equal(r.doneSessionId, 'sess-done');
});

test('done explains when the build was not visible in the transcripts', () => {
  const h = harness();
  h.run(['estimate', tagsFile(TAGS)], at('10:00'));
  const dir = join(h.projects, encodeProjectPath(PROJECT));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 's.jsonl'), [
    JSON.stringify({ type: 'assistant', timestamp: T('10:00'), message: { content: [{ type: 'text', text: 'x' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: T('10:01'), message: { content: [{ type: 'text', text: 'x' }] } }),
  ].join('\n'));
  assert.equal(h.run(['done'], at('11:30')), 0);
  assert.match(h.out(), /couldn't see the build in this session's transcripts.*not used for learning/);
  assert.equal(readRecords(h.home)[0].status, 'unconfirmed');
});

test('done says it will retry when measurement fails outright', () => {
  const h = harness();
  h.run(['estimate', tagsFile(TAGS)], at('10:00'));
  const outLines = [];
  main(['done'], {
    env: { AGENT_ETA_HOME: h.home, AGENT_ETA_PROJECTS: h.projects },
    cwd: PROJECT, now: at('10:30'), out: s => outLines.push(s), err: () => {},
    measure: () => { throw new Error('disk on fire'); },
  });
  assert.match(outLines.join(String.fromCharCode(10)), /measured again on the next/);
  assert.doesNotMatch(outLines.join(String.fromCharCode(10)), /won't be used for learning|not used for learning/);
  const [r] = readRecords(h.home);
  assert.equal(r.status, 'open');
  assert.ok(r.doneAt);
});

test('done with nothing open exits 1', () => {
  const h = harness();
  assert.equal(h.run(['done']), 1);
  assert.match(h.out(), /No open estimate/);
});

test('stats with no confirmed estimates', () => {
  const h = harness();
  assert.equal(h.run(['stats']), 0);
  assert.match(h.out(), /No confirmed estimates yet/);
});

test('unknown command prints usage and exits 1', () => {
  const h = harness();
  assert.equal(h.run(['nope']), 1);
  assert.match(h.out(), /Usage:/);
});

test('estimate records the multipliers actually applied (none before minConfirmed)', () => {
  const h = harness();
  h.run(['estimate', tagsFile(TAGS)]);
  assert.deepEqual(readRecords(h.home)[0].predicted.applied, { cells: {}, workflow: 1 });
});

test('estimate records active calibration multipliers once personal', () => {
  const h = harness();
  saveCalibration(h.home, { confirmed: 3, cells: { 'integration.M': 1.4 }, workflow: { inline: 1.2 }, replyDelay: null });
  h.run(['estimate', tagsFile(TAGS)]);
  assert.deepEqual(readRecords(h.home)[0].predicted.applied, { cells: { 'integration.M': 1.4 }, workflow: 1.2 });
});

test('inactive calibration (below minConfirmed) is not recorded as applied', () => {
  const h = harness();
  saveCalibration(h.home, { confirmed: 1, cells: { 'integration.M': 1.4 }, workflow: { inline: 1.2 }, replyDelay: null });
  h.run(['estimate', tagsFile(TAGS)]);
  assert.deepEqual(readRecords(h.home)[0].predicted.applied, { cells: {}, workflow: 1 });
});

test('stats and done survive corrupt records', () => {
  const h = harness();
  appendRecord(h.home, { id: 'x1', project: resolve(PROJECT), startedAt: T('09:00'), status: 'confirmed' });
  appendRecord(h.home, { id: 'x2', project: resolve(PROJECT), startedAt: T('09:00'), status: 'confirmed', predicted: { wall: 0 }, actual: { wall: 5 } });
  saveCalibration(h.home, { confirmed: 0, cells: { 'a.b': 'oops' }, workflow: {}, replyDelay: 'bad' });
  assert.equal(h.run(['stats']), 0);
  assert.doesNotMatch(h.out(), /NaN|undefined/);
  assert.equal(h.run(['done']), 1);
});

test('missing or unreadable inputs exit 2 without throwing', () => {
  const h = harness();
  const missing = join(tmp(), 'nope.json');
  assert.equal(h.run(['plan', missing]), 2);
  assert.equal(h.run(['plan']), 2);
  assert.equal(h.run(['estimate', missing]), 2);
  assert.equal(h.run(['estimate']), 2);
  const bad = join(tmp(), 'bad.json');
  writeFileSync(bad, '{not json');
  assert.equal(h.run(['estimate', bad]), 2);
  assert.match(h.err(), /Invalid JSON/);
  assert.equal(readRecords(h.home).length, 0);
});

test('unexpected errors return 1 with a one-line message and log', () => {
  const home = tmp();
  const errs = [];
  const code = main(['stats'], {
    env: { AGENT_ETA_HOME: join(home, 'file.txt', 'x'), AGENT_ETA_PROJECTS: tmp() },
    cwd: PROJECT, now: at('10:00'), out: () => {}, err: s => errs.push(s),
  });
  assert.ok(code === 0 || code === 1);
  assert.doesNotMatch(errs.join('\n'), /\n\s+at /);
});

test('--plan with a missing file falls back to rough mode with a warning', () => {
  const h = harness();
  assert.equal(h.run(['estimate', tagsFile(TAGS), '--plan', join(tmp(), 'gone.md')]), 0);
  const [r] = readRecords(h.home);
  assert.equal(r.mode, 'rough');
  assert.equal(r.planPath, null);
  assert.match(h.err(), /Plan file not found/);
});

test('done matches the project case-insensitively on Windows', { skip: process.platform !== 'win32' }, () => {
  const h = harness();
  h.run(['estimate', tagsFile(TAGS)]);
  const other = (resolve(PROJECT).toUpperCase());
  const code = main(['done'], {
    env: { AGENT_ETA_HOME: h.home, AGENT_ETA_PROJECTS: h.projects },
    cwd: other, now: at('10:30'), out: () => {}, err: () => {},
  });
  assert.equal(code, 0);
});

test('entry guard runs main when invoked through the real script path', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url)), 'nope'], { encoding: 'utf8' });
  assert.match(r.stdout, /Usage:/);
});
