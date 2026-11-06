const TASK_HEADING = /^###\s+Task\s+(\d+):\s*(.+?)\s*$/;
const ANY_HEADING = /^#{1,3}\s/;
const FILE_LINE = /^\s*-\s*(?:Create|Modify|Test|Delete):\s*`([^`]+)`/i;
const CHECKBOX = /^\s*-\s\[( |x|X)\]/;

export function parsePlan(text) {
  const lines = text.split(/\r?\n/);
  const workflow = /subagent-driven-development/.test(lines.slice(0, 20).join('\n')) ? 'subagent-driven' : 'inline';
  const tasks = [];
  let cur = null;
  let inFiles = false;
  let inFence = false;
  let totalSteps = 0;
  let checkedSteps = 0;

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h = line.match(TASK_HEADING);
    if (h) {
      cur = { id: Number(h[1]), title: h[2], files: [], steps: 0, done: 0 };
      tasks.push(cur);
      inFiles = false;
      continue;
    }
    if (ANY_HEADING.test(line)) {
      cur = null;
      inFiles = false;
      continue;
    }
    if (!cur) continue;

    if (/^\*\*Files:\*\*/.test(line.trim())) {
      inFiles = true;
      continue;
    }
    if (inFiles) {
      const f = line.match(FILE_LINE);
      if (f) {
        cur.files.push(f[1].replace(/:\d+(?:-\d+)?$/, ''));
        continue;
      }
      if (line.trim() !== '') inFiles = false;
    }

    const c = line.match(CHECKBOX);
    if (c) {
      cur.steps++;
      totalSteps++;
      if (c[1] !== ' ') {
        cur.done++;
        checkedSteps++;
      }
    }
  }

  return { workflow, tasks, totalSteps, checkedSteps, allChecked: totalSteps > 0 && totalSteps === checkedSteps };
}
