// Dev-only. Runs the eta skill N times through `claude -p` on the same description
// and checks every run's range midpoint is within ±20% of the mean.
// Usage: node tools/consistency.mjs "<feature description>" [runs=3]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const description = process.argv[2];
const runs = Number(process.argv[3] ?? 3);
if (!description) {
  console.error('Usage: node tools/consistency.mjs "<feature description>" [runs=3]');
  process.exit(1);
}

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(join(tmpdir(), 'agent-eta-consistency-'));
console.log(`AGENT_ETA_HOME / raw outputs: ${home}`);

// Child env: drop vars that make `claude -p` think it is nested in a Claude Code session.
const env = { ...process.env, AGENT_ETA_HOME: home };
for (const k of Object.keys(env)) {
  if (k === 'CLAUDECODE' || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || k.startsWith('CLAUDE_CODE_')) delete env[k];
}

function toMinutes(s) {
  const h = s.match(/(\d+)\s*h/);
  const m = s.match(/(\d+)\s*(?:m\b|min)/);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

const win = process.platform === 'win32';
const mids = [];
for (let i = 1; i <= runs; i++) {
  // Fresh empty project dir per run so rough mode sees no code.
  const cwd = mkdtempSync(join(tmpdir(), `agent-eta-project-${i}-`));
  const args = [
    '-p', `Use the agent-eta:eta skill to estimate: ${description}`,
    '--plugin-dir', pluginDir,
    '--allowedTools', 'Bash', 'Read', 'Glob', 'Grep', 'Write', 'Agent', 'Skill',
  ];
  const opts = { encoding: 'utf8', env, cwd, timeout: 600000, maxBuffer: 64 * 1024 * 1024, input: '' };
  let r = spawnSync('claude', args, opts);
  // Windows .cmd shim fallback (npm installs): needs a shell, so quote args ourselves.
  if (r.error && r.error.code === 'ENOENT' && win) {
    const q = a => `"${String(a).replace(/"/g, '\\"')}"`;
    r = spawnSync(['claude', ...args].map((a, j) => (j === 0 ? a : q(a))).join(' '), { ...opts, shell: true });
  }
  if (r.error) {
    console.error(`Run ${i} failed to start: ${r.error.message}`);
    process.exit(1);
  }
  const rawPath = join(home, `run-${i}.txt`);
  writeFileSync(rawPath, `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}`);
  console.log(`Run ${i} raw output: ${rawPath}`);
  const m = (r.stdout ?? '').match(/Total:\s*(.+?)\s*–\s*(.+?)\s*\(wall clock\)/);
  if (!m) {
    console.error(`Run ${i}: no "Total:" line found (exit ${r.status}). See ${rawPath}\n${(r.stdout ?? '').slice(-1500)}\n${(r.stderr ?? '').slice(-500)}`);
    process.exit(1);
  }
  const mid = (toMinutes(m[1]) + toMinutes(m[2])) / 2;
  mids.push(mid);
  console.log(`Run ${i}: ${m[1]} – ${m[2]}  (midpoint ${mid} min)`);
}

const mean = mids.reduce((s, x) => s + x, 0) / mids.length;
const worst = Math.max(...mids.map(x => Math.abs(x - mean) / mean));
console.log(`Mean midpoint ${mean.toFixed(1)} min; worst deviation ${(worst * 100).toFixed(0)}%`);
if (worst > 0.2) {
  console.log('FAIL: runs disagree by more than 20%. Tighten the tagging rules in skills/eta/SKILL.md.');
  process.exit(1);
}
console.log('PASS');
