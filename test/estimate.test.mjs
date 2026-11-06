import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate } from '../scripts/estimate.mjs';
import { testParams, near } from './helpers.mjs';

const mixed = () => ({
  workflow: 'inline',
  tasks: [
    { id: 1, title: 'Billing page', size: 'M', kind: 'integration', flags: ['manual_test'] },
    { id: 2, title: 'Add SDK', size: 'S', kind: 'mechanical', flags: ['new_dependency'] },
    { id: 3, title: 'Stripe webhooks', size: 'L', kind: 'judgment', flags: ['external_service'] },
  ],
});

test('agent, user and wall minutes for a mixed inline build', () => {
  const e = estimate(mixed(), testParams());
  near(e.tasks[0].agent, 10);
  near(e.tasks[1].agent, 6);
  near(e.tasks[2].agent, 30);
  near(e.agentMinutes, 46);
  near(e.userActiveMinutes, 10);
  near(e.replyDelayMinutes, 4);
  near(e.userMinutes, 14);
  near(e.wall, 60);
  assert.equal(e.manualTests, 1);
  assert.equal(e.questions, 0);
  assert.equal(e.approvals, 0);
});

test('range and risk', () => {
  const e = estimate(mixed(), testParams());
  near(e.low, 51);
  near(e.tasks[2].extra, 82.5);
  near(e.high, 60 + Math.sqrt(8 ** 2 + 1.8 ** 2 + 82.5 ** 2));
  assert.equal(e.risk.id, 3);
  assert.equal(e.risk.title, 'Stripe webhooks');
});

test('subagent-driven workflow multiplies agent time', () => {
  const e = estimate({ workflow: 'subagent-driven', tasks: [{ id: 1, title: 'A', size: 'M', kind: 'integration' }] }, testParams());
  near(e.agentMinutes, 18);
  near(e.wall, 18);
});

test('superpowers phases add agent time, user time and gates', () => {
  const input = { workflow: 'inline', phases: ['brainstorm', 'spec', 'plan'], tasks: [{ id: 1, title: 'A', size: 'S', kind: 'mechanical' }] };
  const e = estimate(input, testParams());
  near(e.agentMinutes, 23);
  near(e.userActiveMinutes, 20);
  assert.equal(e.questions, 5);
  assert.equal(e.approvals, 2);
  assert.equal(e.gates, 7);
  near(e.replyDelayMinutes, 28);
  near(e.wall, 71);
});

test('frontLoad collapses phase gates into one', () => {
  const input = { workflow: 'inline', phases: ['brainstorm', 'spec', 'plan'], tasks: [{ id: 1, title: 'A', size: 'S', kind: 'mechanical' }] };
  const e = estimate(input, testParams(), { frontLoad: true });
  near(e.replyDelayMinutes, 4);
  near(e.wall, 47);
});

test('batchTests collapses manual-test gates into one', () => {
  const t = id => ({ id, title: `T${id}`, size: 'S', kind: 'mechanical', flags: ['manual_test'] });
  const input = { workflow: 'inline', tasks: [t(1), t(2), t(3)] };
  near(estimate(input, testParams()).replyDelayMinutes, 12);
  near(estimate(input, testParams(), { batchTests: true }).replyDelayMinutes, 4);
  near(estimate(input, testParams(), { batchTests: true }).userActiveMinutes, 15);
});

test('parallel lanes overlap two tasks and add merge overhead', () => {
  const input = {
    workflow: 'inline',
    tasks: [
      { id: 1, title: 'A', size: 'M', kind: 'integration' },
      { id: 2, title: 'B', size: 'M', kind: 'integration' },
      { id: 3, title: 'C', size: 'S', kind: 'mechanical' },
    ],
  };
  near(estimate(input, testParams()).agentMinutes, 23);
  near(estimate(input, testParams(), { parallel: [[1], [2]] }).agentMinutes, 16);
});

test('invalid input throws the validation error', () => {
  assert.throws(() => estimate({ workflow: 'inline', tasks: [{ id: 1, title: 'A', size: 'Q', kind: 'mechanical' }] }, testParams()), /Invalid tags/);
});
