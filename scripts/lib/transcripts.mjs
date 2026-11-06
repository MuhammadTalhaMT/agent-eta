import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const NOT_HUMAN = /^\s*(<task-notification>|<bash-stdout>|<bash-stderr>|<local-command-stdout>|<local-command-stderr>|\[Request interrupted)/;

export function projectsRoot(env = process.env) {
  if (env.AGENT_ETA_PROJECTS) return env.AGENT_ETA_PROJECTS;
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

export const encodeProjectPath = p => p.replace(/[^A-Za-z0-9]/g, '-');

export function isHumanPrompt(e) {
  if (e.type !== 'user' || e.isMeta || e.isCompactSummary || e.toolUseResult || e.isSidechain) return false;
  const c = e.message?.content;
  let text;
  if (typeof c === 'string') {
    text = c;
  } else if (Array.isArray(c)) {
    if (c.some(b => b?.type === 'tool_result')) return false;
    text = c.filter(b => b?.type === 'text').map(b => b.text).join(' ');
    if (!text && !c.some(b => b?.type === 'image')) return false;
  } else {
    return false;
  }
  return !NOT_HUMAN.test(text);
}

export function readEntries(file, window = null) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    if (window) {
      const m = line.match(/"timestamp":"([^"]+)"/);
      if (m) {
        const t = Date.parse(m[1]);
        if (t < window.startMs || t > window.endMs) continue;
      }
    }
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if ((e.type !== 'user' && e.type !== 'assistant') || !e.timestamp) continue;
    const ts = Date.parse(e.timestamp);
    if (Number.isNaN(ts)) continue;
    out.push({ ts, human: isHumanPrompt(e) });
  }
  return out;
}

export function transcriptFiles(projectDir, sessionId = null) {
  const out = { main: [], subagents: [] };
  if (!existsSync(projectDir)) return out;
  if (sessionId) {
    const main = join(projectDir, `${sessionId}.jsonl`);
    if (existsSync(main)) out.main.push(main);
    const sub = join(projectDir, sessionId, 'subagents');
    if (existsSync(sub)) for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) out.subagents.push(join(sub, f));
    return out;
  }
  for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
    const full = join(projectDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.main.push(full);
    } else if (entry.isDirectory()) {
      const sub = join(full, 'subagents');
      if (!existsSync(sub)) continue;
      for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) out.subagents.push(join(sub, f));
    }
  }
  return out;
}

const touchedSince = (file, startMs) => {
  try {
    return statSync(file).mtimeMs >= startMs;
  } catch {
    return false;
  }
};

export function measureWindow(projectDir, startMs, endMs, breakMinutes, sessionId = null) {
  const { main, subagents } = transcriptFiles(projectDir, sessionId);
  const entries = [];
  for (const f of [...main, ...subagents]) {
    if (!touchedSince(f, startMs)) continue;
    for (const e of readEntries(f, { startMs, endMs })) if (e.ts >= startMs && e.ts <= endMs) entries.push(e);
  }
  entries.sort((a, b) => a.ts - b.ts);

  const breakMs = breakMinutes * 60000;
  let agentMinutes = 0;
  let userMinutes = 0;
  let humanGaps = 0;
  for (let i = 1; i < entries.length; i++) {
    const gap = entries[i].ts - entries[i - 1].ts;
    if (gap > breakMs) continue;
    if (entries[i].human) {
      userMinutes += gap / 60000;
      humanGaps++;
    } else {
      agentMinutes += gap / 60000;
    }
  }
  return { agentMinutes, userMinutes, humanGaps, entries: entries.length };
}

export function subagentRuns(projectDir, startMs, endMs, sessionId = null) {
  const runs = [];
  for (const f of transcriptFiles(projectDir, sessionId).subagents) {
    if (!touchedSince(f, startMs)) continue;
    const es = readEntries(f, { startMs, endMs }).filter(e => e.ts >= startMs && e.ts <= endMs);
    if (es.length < 2) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of es) {
      if (e.ts < lo) lo = e.ts;
      if (e.ts > hi) hi = e.ts;
    }
    let description = '';
    try {
      description = JSON.parse(readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8')).description ?? '';
    } catch {
      description = '';
    }
    runs.push({ description, minutes: (hi - lo) / 60000 });
  }
  return runs;
}
