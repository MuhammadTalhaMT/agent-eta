import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInput } from '../scripts/lib/validate.mjs';

const good = () => ({
  workflow: 'inline',
  tasks: [
    { id: 1, title: 'Parser', size: 'M', kind: 'integration' },
    { id: 2, title: 'CLI', size: 'S', kind: 'mechanical', flags: ['manual_test'], files: ['a.mjs'], depends_on: [1] },
  ],
});

test('valid input is normalised with default arrays', () => {
  const v = validateInput(good());
  assert.deepEqual(v.phases, []);
  assert.deepEqual(v.tasks[0], { id: 1, title: 'Parser', size: 'M', kind: 'integration', flags: [], files: [], depends_on: [] });
  assert.deepEqual(v.tasks[1].depends_on, [1]);
});

test('bad size names the field', () => {
  const i = good();
  i.tasks[0].size = 'XL';
  assert.throws(() => validateInput(i), /Invalid tags: tasks\[0\]\.size must be one of S, M, L/);
});

test('bad workflow names the field', () => {
  const i = good();
  i.workflow = 'magic';
  assert.throws(() => validateInput(i), /Invalid tags: workflow/);
});

test('unknown flag names the field', () => {
  const i = good();
  i.tasks[1].flags = ['urgent'];
  assert.throws(() => validateInput(i), /Invalid tags: tasks\[1\]\.flags\[0\]/);
});

test('dependency on unknown task is rejected', () => {
  const i = good();
  i.tasks[1].depends_on = [7];
  assert.throws(() => validateInput(i), /Invalid tags: tasks\[1\]\.depends_on\[0\] references unknown task 7/);
});

test('empty task list is rejected', () => {
  assert.throws(() => validateInput({ workflow: 'inline', tasks: [] }), /Invalid tags: tasks must be a non-empty array/);
});

test('duplicate ids are rejected', () => {
  const i = good();
  i.tasks[1].id = 1;
  i.tasks[1].depends_on = [];
  assert.throws(() => validateInput(i), /duplicates id 1/);
});

test('unknown phase is rejected', () => {
  const i = good();
  i.phases = ['brainstorm', 'deploy'];
  assert.throws(() => validateInput(i), /Invalid tags: phases\[1\]/);
});

test('non-string or empty files entry is rejected', () => {
  const i = good();
  i.tasks[1].files = ['a.mjs', ''];
  assert.throws(() => validateInput(i), /Invalid tags: tasks\[1\]\.files\[1\] must be a non-empty string/);
  i.tasks[1].files = [5];
  assert.throws(() => validateInput(i), /Invalid tags: tasks\[1\]\.files\[0\] must be a non-empty string/);
});

test('non-integer depends_on entry is rejected', () => {
  const i = good();
  i.tasks[1].depends_on = ['1'];
  assert.throws(() => validateInput(i), /Invalid tags: tasks\[1\]\.depends_on\[0\] must be an integer/);
});

test('task depending on itself is rejected', () => {
  const i = good();
  i.tasks[1].depends_on = [2];
  assert.throws(() => validateInput(i), /Invalid tags: tasks\[1\]\.depends_on\[0\] cannot reference the task itself/);
});

test('duplicate phases are rejected', () => {
  const i = good();
  i.phases = ['spec', 'spec'];
  assert.throws(() => validateInput(i), /Invalid tags: phases\[1\] duplicates spec/);
});
