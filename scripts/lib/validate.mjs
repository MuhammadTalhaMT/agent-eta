const SIZES = ['S', 'M', 'L'];
const KINDS = ['mechanical', 'integration', 'judgment'];
const FLAGS = ['manual_test', 'external_service', 'new_dependency'];
const WORKFLOWS = ['inline', 'subagent-driven'];
const PHASES = ['brainstorm', 'spec', 'plan'];

function fail(field, why) {
  throw new Error(`Invalid tags: ${field} ${why}`);
}

const oneOf = list => `must be one of ${list.join(', ')}`;

export function validateInput(input) {
  if (!input || typeof input !== 'object') fail('input', 'must be an object');
  if (!WORKFLOWS.includes(input.workflow)) fail('workflow', oneOf(WORKFLOWS));

  const phases = input.phases ?? [];
  if (!Array.isArray(phases)) fail('phases', 'must be an array');
  phases.forEach((p, i) => {
    if (!PHASES.includes(p)) fail(`phases[${i}]`, oneOf(PHASES));
    if (phases.indexOf(p) !== i) fail(`phases[${i}]`, `duplicates ${p}`);
  });

  if (!Array.isArray(input.tasks) || input.tasks.length === 0) fail('tasks', 'must be a non-empty array');

  const ids = new Set();
  input.tasks.forEach((t, i) => {
    const at = `tasks[${i}]`;
    if (!t || typeof t !== 'object') fail(at, 'must be an object');
    if (!Number.isInteger(t.id)) fail(`${at}.id`, 'must be an integer');
    if (ids.has(t.id)) fail(`${at}.id`, `duplicates id ${t.id}`);
    ids.add(t.id);
    if (typeof t.title !== 'string' || !t.title.trim()) fail(`${at}.title`, 'must be a non-empty string');
    if (!SIZES.includes(t.size)) fail(`${at}.size`, oneOf(SIZES));
    if (!KINDS.includes(t.kind)) fail(`${at}.kind`, oneOf(KINDS));
    for (const key of ['flags', 'files', 'depends_on']) {
      if (t[key] !== undefined && !Array.isArray(t[key])) fail(`${at}.${key}`, 'must be an array');
    }
    (t.flags ?? []).forEach((f, j) => { if (!FLAGS.includes(f)) fail(`${at}.flags[${j}]`, oneOf(FLAGS)); });
    (t.files ?? []).forEach((f, j) => {
      if (typeof f !== 'string' || !f.trim()) fail(`${at}.files[${j}]`, 'must be a non-empty string');
    });
    (t.depends_on ?? []).forEach((d, j) => {
      if (!Number.isInteger(d)) fail(`${at}.depends_on[${j}]`, 'must be an integer');
      if (d === t.id) fail(`${at}.depends_on[${j}]`, 'cannot reference the task itself');
    });
  });

  input.tasks.forEach((t, i) => {
    (t.depends_on ?? []).forEach((d, j) => {
      if (!ids.has(d)) fail(`tasks[${i}].depends_on[${j}]`, `references unknown task ${d}`);
    });
  });

  return {
    workflow: input.workflow,
    phases: [...phases],
    tasks: input.tasks.map(t => ({
      id: t.id,
      title: t.title,
      size: t.size,
      kind: t.kind,
      flags: [...(t.flags ?? [])],
      files: [...(t.files ?? [])],
      depends_on: [...(t.depends_on ?? [])],
    })),
  };
}
