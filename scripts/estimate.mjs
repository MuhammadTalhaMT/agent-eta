import { validateInput } from './lib/validate.mjs';

export function estimate(rawInput, params, options = {}) {
  const input = validateInput(rawInput);
  const { frontLoad = false, batchTests = false, parallel = null } = options;
  const wf = params.workflowFactor[input.workflow];

  const tasks = input.tasks.map(t => {
    const spread = params.spread[t.kind] * (t.flags.includes('external_service') ? params.externalSpread : 1);
    const agent = params.base[t.kind][t.size] * wf + (t.flags.includes('new_dependency') ? params.depMinutes : 0);
    const manualTest = t.flags.includes('manual_test');
    return {
      id: t.id,
      title: t.title,
      kind: t.kind,
      size: t.size,
      agent,
      manualTest,
      userActive: manualTest ? params.manualTestActive[t.size] : 0,
      extra: agent * (spread - 1),
    };
  });

  let phaseAgent = 0;
  let phaseActive = 0;
  for (const ph of input.phases) {
    phaseAgent += params.phaseAgent[ph];
    phaseActive += ph === 'brainstorm'
      ? params.phaseActive.brainstormPerQuestion * params.brainstormQuestions
      : params.phaseActive[ph];
  }
  const questions = input.phases.includes('brainstorm') ? params.brainstormQuestions : 0;
  const approvals = input.phases.filter(p => p !== 'brainstorm').length;
  let phaseGates = questions + approvals;
  if (frontLoad && phaseGates > 1) phaseGates = 1;

  const manualTests = tasks.filter(t => t.manualTest).length;
  let testGates = manualTests;
  if (batchTests && testGates > 1) testGates = 1;

  const taskAgentSum = tasks.reduce((s, t) => s + t.agent, 0);
  let taskAgentWall = taskAgentSum;
  if (parallel) {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const lane = ids => ids.reduce((s, id) => s + byId.get(id).agent, 0);
    const a = lane(parallel[0]);
    const b = lane(parallel[1]);
    taskAgentWall = taskAgentSum - a - b + Math.max(a, b) + params.mergeOverhead;
  }

  const agentMinutes = phaseAgent + taskAgentWall;
  const userActiveMinutes = phaseActive + tasks.reduce((s, t) => s + t.userActive, 0);
  const gates = phaseGates + testGates;
  const replyDelayMinutes = gates * params.replyDelay;
  const wall = agentMinutes + userActiveMinutes + replyDelayMinutes;
  const low = wall * params.lowFactor;
  const high = wall + Math.sqrt(tasks.reduce((s, t) => s + t.extra ** 2, 0));
  const top = tasks.reduce((r, t) => (t.extra > r.extra ? t : r), tasks[0]);

  return {
    workflow: input.workflow,
    phases: input.phases,
    tasks,
    agentMinutes,
    userActiveMinutes,
    replyDelayMinutes,
    userMinutes: userActiveMinutes + replyDelayMinutes,
    questions,
    approvals,
    manualTests,
    gates,
    wall,
    low,
    high,
    risk: { id: top.id, title: top.title, extra: top.extra },
  };
}
