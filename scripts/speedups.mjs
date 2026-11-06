import { estimate } from './estimate.mjs';
import { validateInput } from './lib/validate.mjs';

const MIN_SAVING = 5;
const MAX_TIPS = 3;

function ancestors(tasks) {
  const deps = new Map(tasks.map(t => [t.id, t.depends_on ?? []]));
  const result = new Map();
  for (const t of tasks) {
    const seen = new Set();
    const stack = [...deps.get(t.id)];
    while (stack.length) {
      const d = stack.pop();
      if (seen.has(d)) continue;
      seen.add(d);
      stack.push(...(deps.get(d) ?? []));
    }
    result.set(t.id, seen);
  }
  return result;
}

export function independentPairs(tasks) {
  const anc = ancestors(tasks);
  const pairs = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i];
      const b = tasks[j];
      const fa = a.files ?? [];
      const fb = b.files ?? [];
      if (!fa.length || !fb.length) continue;
      if (anc.get(a.id).has(b.id) || anc.get(b.id).has(a.id)) continue;
      if (fa.some(f => fb.includes(f))) continue;
      pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

export function speedups(rawInput, params, base = estimate(rawInput, params)) {
  const input = validateInput(rawInput);
  const saved = options => base.wall - estimate(input, params, options).wall;
  const tips = [];

  let best = null;
  for (const [a, b] of independentPairs(input.tasks)) {
    const s = saved({ parallel: [[a], [b]] });
    if (!best || s > best.saved) best = { a, b, saved: s };
  }
  if (best) {
    tips.push({
      kind: 'parallel',
      saved: best.saved,
      text: `Tasks ${best.a} & ${best.b} are independent → run them in parallel, each in its own git worktree`,
    });
  }

  const phaseGates = base.questions + base.approvals;
  if (phaseGates > 1) {
    tips.push({
      kind: 'frontload',
      saved: saved({ frontLoad: true }),
      text: `${phaseGates} questions/approvals before the build → answer them in one go`,
    });
  }

  if (base.manualTests > 1) {
    tips.push({
      kind: 'batch-tests',
      saved: saved({ batchTests: true }),
      text: `${base.manualTests} manual tests → batch them into one test pass at the end`,
    });
  }

  const out = tips
    .filter(t => t.saved >= MIN_SAVING)
    .sort((x, y) => y.saved - x.saved)
    .slice(0, MAX_TIPS);

  const mech = input.tasks.filter(t => t.kind === 'mechanical').map(t => t.id);
  if (input.workflow === 'subagent-driven' && mech.length && out.length < MAX_TIPS) {
    const many = mech.length > 1;
    out.push({
      kind: 'cheaper-model',
      saved: 0,
      text: `Task${many ? 's' : ''} ${mech.join(', ')} ${many ? 'are' : 'is'} mechanical → use a cheaper model (lower cost, ~same time)`,
    });
  }
  return out;
}
