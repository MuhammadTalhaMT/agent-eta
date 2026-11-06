import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  encodeProjectPath, isHumanPrompt, readEntries, measureWindow, subagentRuns, projectsRoot,
} from '../scripts/lib/transcripts.mjs';
import { near, tmp } from './helpers.mjs';

const T = hhmm => `2026-01-01T${hhmm}:00.000Z`;
const ms = hhmm => Date.parse(T(hhmm));
const assistant = hhmm => JSON.stringify({ type: 'assistant', timestamp: T(hhmm), message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });
const human = (hhmm, text = 'please continue') => JSON.stringify({ type: 'user', timestamp: T(hhmm), message: { role: 'user', content: text } });
const toolResult = hhmm => JSON.stringify({ type: 'user', timestamp: T(hhmm), toolUseResult: {}, message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } });

function fixtureProject() {
  const dir = tmp();
  writeFileSync(join(dir, 'sess-1.jsonl'), [
    human('09:00'), // before the window
    assistant('10:01'),
    human('10:05'),
    toolResult('10:06'),
    JSON.stringify({ type: 'last-prompt', sessionId: 'x' }), // ignored: no timestamp, not a message
    '{broken json',
    assistant('10:20'),
    assistant('11:10'), // 50-min gap = break
    assistant('11:12'),
  ].join('\n'));
  const sub = join(dir, 'sess-1', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-a1.jsonl'), [assistant('10:10'), assistant('10:07')].join('\n'));
  writeFileSync(join(sub, 'agent-a1.meta.json'), JSON.stringify({ description: 'Implement Task 2: parser' }));
  return dir;
}

test('encodeProjectPath matches Claude Code folder names', () => {
  assert.equal(encodeProjectPath('C:\\Users\\muham'), 'C--Users-muham');
  assert.equal(encodeProjectPath('D:\\Payday 3'), 'D--Payday-3');
  assert.equal(encodeProjectPath('/home/a/my.app'), '-home-a-my-app');
});

test('projectsRoot honours overrides', () => {
  assert.equal(projectsRoot({ AGENT_ETA_PROJECTS: '/x' }), '/x');
  assert.equal(projectsRoot({ CLAUDE_CONFIG_DIR: '/cfg' }), join('/cfg', 'projects'));
});

test('isHumanPrompt', () => {
  const u = content => ({ type: 'user', message: { content } });
  assert.equal(isHumanPrompt(u('fix the bug')), true);
  assert.equal(isHumanPrompt(u([{ type: 'text', text: 'fix it' }])), true);
  assert.equal(isHumanPrompt(u([{ type: 'tool_result', content: 'x' }])), false);
  assert.equal(isHumanPrompt({ ...u('x'), isMeta: true }), false);
  assert.equal(isHumanPrompt({ ...u('x'), isCompactSummary: true }), false);
  assert.equal(isHumanPrompt({ ...u('x'), toolUseResult: {} }), false);
  assert.equal(isHumanPrompt(u('<task-notification> done')), false);
  assert.equal(isHumanPrompt(u('[Request interrupted by user]')), false);
  assert.equal(isHumanPrompt(u('<bash-stdout>hi</bash-stdout>')), false);
  assert.equal(isHumanPrompt({ type: 'assistant', message: { content: 'x' } }), false);
});

test('readEntries skips non-messages and broken lines', () => {
  const dir = fixtureProject();
  const es = readEntries(join(dir, 'sess-1.jsonl'));
  assert.equal(es.length, 7);
  assert.equal(es.filter(e => e.human).length, 2);
});

test('measureWindow splits agent and user time and drops breaks', () => {
  const m = measureWindow(fixtureProject(), ms('10:00'), ms('11:30'), 30);
  near(m.agentMinutes, 17);
  near(m.userMinutes, 4);
  assert.equal(m.humanGaps, 1);
  assert.equal(m.entries, 8);
});

test('measureWindow on a missing folder is empty', () => {
  const m = measureWindow(join(tmp(), 'nope'), 0, Date.now(), 30);
  assert.equal(m.entries, 0);
});

test('subagentRuns reads description and duration', () => {
  const runs = subagentRuns(fixtureProject(), ms('10:00'), ms('11:30'));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].description, 'Implement Task 2: parser');
  near(runs[0].minutes, 3);
});
