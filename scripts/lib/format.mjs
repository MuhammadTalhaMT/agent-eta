export function formatDuration(minutes) {
  const m = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatReport(est, tips, status, warning = null) {
  const parts = [];
  if (est.questions) parts.push(plural(est.questions, 'question'));
  if (est.approvals) parts.push(plural(est.approvals, 'approval'));
  if (est.manualTests) parts.push(plural(est.manualTests, 'manual test'));

  const lines = [
    `Total: ${formatDuration(est.low)} – ${formatDuration(est.high)} (wall clock)`,
    `  Agents working:   ~${formatDuration(est.agentMinutes)}   (you can walk away)`,
    `  You needed:       ~${formatDuration(est.userActiveMinutes)}   (${parts.length ? parts.join(', ') : 'no checkpoints'})`,
    `  Waiting on you:   ~${formatDuration(est.replyDelayMinutes)}   (Claude idle until you reply)`,
    `  Biggest risk:     Task ${est.risk.id} — ${est.risk.title} (+${formatDuration(est.risk.extra)} if it goes badly)`,
  ];

  if (tips.length) {
    const total = tips.reduce((s, t) => s + Math.max(0, Math.round(t.saved)), 0);
    lines.push('', total >= 1 ? `Speed-ups (−${formatDuration(total)}):` : 'Speed-ups:');
    for (const t of tips) lines.push(`  • ${t.text}${Math.round(t.saved) >= 1 ? ` (−${formatDuration(t.saved)})` : ''}`);
  }

  lines.push('', `Calibration: ${status}`);
  if (warning) lines.push(`Warning: ${warning}`);
  return lines.join('\n');
}
