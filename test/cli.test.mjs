import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main } from '../scripts/cli.mjs';
import { encodeProjectPath } from '../scripts/lib/transcripts.mjs';
import { readRecords } from '../scripts/lib/store.mjs';
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
