import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speedups, independentPairs } from '../scripts/speedups.mjs';
import { testParams, near } from './helpers.mjs';

const task = (id, kind, size, extra = {}) => ({ id, title: `Task ${id}`, kind, size, ...extra });

test('independentPairs respects transitive depends_on and shared files', () => {
  const tasks = [
    task(1, 'integration', 'M', { files: ['a.ts'] }),
    task(2, 'integration', 'M', { files: ['b.ts'] }),
    task(3, 'mechanical', 'S', { files: ['c.ts'], depends_on: [1] }),
    task(4, 'mechanical', 'S', { files: ['d.ts'], depends_on: [3] }),
    task(5, 'mechanical', 'S', { files: ['b.ts'] }),
  ].map(t => ({ flags: [], depends_on: [], ...t }));
  const pairs = independentPairs(tasks).map(p => p.join('-'));
  assert.ok(pairs.includes('1-2'));
  assert.ok(!pairs.includes('1-3'), 'direct dependency');
  assert.ok(!pairs.includes('1-4'), 'transitive dependency');
  assert.ok(!pairs.includes('2-5'), 'shared file');
});

test('tasks without files are never parallelised', () => {
  const input = { workflow: 'inline', tasks: [task(1, 'integration', 'L'), task(2, 'integration', 'L')] };
  assert.equal(speedups(input, testParams()).filter(t => t.kind === 'parallel').length, 0);
});

test('parallel tip picks the best pair and prices it by re-estimating', () => {
  const input = {
    workflow: 'inline',
    tasks: [
      task(1, 'integration', 'M', { files: ['a.ts'] }),
      task(2, 'integration', 'M', { files: ['b.ts'] }),
      task(3, 'mechanical', 'S', { files: ['a.ts'], depends_on: [1] }),
    ],
  };
  const tips = speedups(input, testParams());
  assert.equal(tips[0].kind, 'parallel');
  near(tips[0].saved, 7);
  assert.match(tips[0].text, /Tasks 1 & 2/);
  assert.equal(tips[1].kind, 'cheaper-model');
  assert.equal(tips[1].saved, 0);
  assert.match(tips[1].text, /Task 3 is mechanical/);
});

test('front-load tip for superpowers phases', () => {
  const input = { workflow: 'inline', phases: ['brainstorm', 'spec', 'plan'], tasks: [task(1, 'integration', 'M')] };
  const tip = speedups(input, testParams()).find(t => t.kind === 'frontload');
  near(tip.saved, 24);
});

test('tips saving under 5 minutes are dropped', () => {
  const input = { workflow: 'inline', phases: ['spec', 'plan'], tasks: [task(1, 'integration', 'M')] };
  assert.equal(speedups(input, testParams()).length, 0);
});

test('at most 3 tips, sorted by minutes saved; cost tip only if room', () => {
  const input = {
    workflow: 'inline',
    phases: ['brainstorm', 'spec', 'plan'],
    tasks: [
      task(1, 'integration', 'M', { files: ['a.ts'], flags: ['manual_test'] }),
      task(2, 'integration', 'M', { files: ['b.ts'], flags: ['manual_test'] }),
      task(3, 'mechanical', 'S', { files: ['a.ts'], flags: ['manual_test'], depends_on: [1] }),
    ],
  };
  const tips = speedups(input, testParams());
  assert.deepEqual(tips.map(t => t.kind), ['frontload', 'batch-tests', 'parallel']);
  near(tips[0].saved, 24);
  near(tips[1].saved, 8);
  near(tips[2].saved, 7);
});
