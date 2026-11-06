// Dev-only. Reads the author's local Claude Code transcripts and derives starting numbers.
// Only aggregate numbers are written; no transcript text, file names or project names.
// Usage: node tools/seed-defaults.mjs          (print only)
//        node tools/seed-defaults.mjs --write  (also update data/defaults.json)
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectsRoot, readEntries } from '../scripts/lib/transcripts.mjs';
import { loadDefaults, DEFAULTS_PATH } from '../scripts/lib/config.mjs';

const MIN_RUN = 0.5;
const MAX_RUN = 120;
const MAX_REPLY = 30;
const KIND_FACTOR = { mechanical: 0.6, integration: 1.0, judgment: 1.6 };

const round1 = x => Math.round(x * 10) / 10;
function pct(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

const root = projectsRoot();
const runs = [];
const replies = [];

for (const proj of readdirSync(root, { withFileTypes: true })) {
  if (!proj.isDirectory()) continue;
  const pdir = join(root, proj.name);
  for (const entry of readdirSync(pdir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const es = readEntries(join(pdir, entry.name)).sort((a, b) => a.ts - b.ts);
      for (let i = 1; i < es.length; i++) {
        if (!es[i].human) continue;
        const gap = (es[i].ts - es[i - 1].ts) / 60000;
        if (gap > 0 && gap <= MAX_REPLY) replies.push(gap);
      }
    } else if (entry.isDirectory()) {
      const sub = join(pdir, entry.name, 'subagents');
      if (!existsSync(sub)) continue;
      for (const f of readdirSync(sub)) {
        if (!f.endsWith('.jsonl')) continue;
        const es = readEntries(join(sub, f));
        if (es.length < 2) continue;
        let lo = Infinity;
        let hi = -Infinity;
        for (const e of es) {
          if (e.ts < lo) lo = e.ts;
          if (e.ts > hi) hi = e.ts;
        }
        const minutes = (hi - lo) / 60000;
        if (minutes >= MIN_RUN && minutes <= MAX_RUN) runs.push(minutes);
      }
    }
  }
}

if (runs.length < 30 || replies.length < 30) {
  console.error(`Not enough data (runs=${runs.length}, replies=${replies.length}); need 30 of each.`);
  process.exit(1);
}

const [p25, p50, p75] = [0.25, 0.5, 0.75].map(p => pct(runs, p));
const base = {};
for (const [kind, f] of Object.entries(KIND_FACTOR)) {
  base[kind] = { S: round1(p25 * f), M: round1(p50 * f), L: round1(p75 * f) };
}
const replyDelay = round1(pct(replies, 0.5));

console.log(`Subagent runs: ${runs.length}  p25=${round1(p25)}  p50=${round1(p50)}  p75=${round1(p75)} min`);
console.log(`Human replies: ${replies.length}  median=${replyDelay} min`);
console.log('base =', JSON.stringify(base));

if (process.argv.includes('--write')) {
  const d = loadDefaults();
  d.base = base;
  d.replyDelay = replyDelay;
  writeFileSync(DEFAULTS_PATH, `${JSON.stringify(d, null, 2)}\n`);
  console.log(`Wrote ${DEFAULTS_PATH}`);
}
