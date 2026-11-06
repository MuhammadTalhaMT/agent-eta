# agent-eta

Ask Claude "how long will this take?" and you get a human developer's estimate. With Claude Code and subagents, typing is nearly free. The real time goes to waiting on you, verification, tasks that must run in order, and rework.

agent-eta estimates build time the way it actually unfolds with Claude Code, and gets more accurate the more you use it.

```
Total: 1h 10m – 1h 50m (wall clock)
  Agents working:   ~50 min   (you can walk away)
  You needed:       ~25 min   (5 questions, 2 approvals, 1 manual test)
  Waiting on you:   ~28 min   (Claude idle until you reply)
  Biggest risk:     Task 3 — Stripe webhooks (+30 min if it goes badly)

Speed-ups (−25 min):
  • Tasks 2 & 4 are independent → run them in parallel, each in its own git worktree (−15 min)
  • 7 questions/approvals before the build → answer them in one go (−10 min)
  • Tasks 1, 5 are mechanical → use a cheaper model (lower cost, ~same time)

Calibration: default numbers (3 more confirmed estimates until personal)
```

## Install

```
/plugin marketplace add <owner>/agent-eta
/plugin install agent-eta@agent-eta
```

Requires Node.js 18+ (already present wherever Claude Code runs).

## Use

| Command | What it does |
|---|---|
| `/agent-eta:eta add Stripe billing` | Rough estimate from a description |
| `/agent-eta:eta docs/plans/billing.md` | Precise estimate from a plan file (superpowers format) |
| `/agent-eta:eta-done` | Mark the latest estimate finished so it can learn |
| `/agent-eta:eta-stats` | Predicted vs actual for your last 10 estimates |

## How it learns

Each estimate is saved locally. When the work is finished — you run `/agent-eta:eta-done`, or every checkbox in the plan is ticked — agent-eta measures the real time from your Claude Code transcripts (`~/.claude/projects`). It separates agent time from your reply time and ignores breaks over 30 minutes. It reads only two Claude Code sessions, plus their subagents: the one where you ran `/agent-eta:eta` and the one where you ran `/agent-eta:eta-done`. Other sessions open in the same folder don't skew it. So if you `/clear` or start a new session to build, run `/agent-eta:eta-done` from the session where you built. Work done in any third session isn't seen. If the measured agent time comes out under 20% of the prediction, agent-eta assumes it missed the build, marks the estimate unconfirmed, and doesn't learn from it. When a plan's checkboxes signal "done", the finish time is the plan file's last-modified time, so a later rebase or checkout that touches the file can stretch it. Running `/agent-eta:eta-done` is more accurate. Each result nudges your personal numbers 30% of the way toward reality, capped at ×0.5–×2 per update. Corrections switch on after 3 confirmed estimates. Estimates with no done signal within 14 days are ignored.

## Privacy

Everything stays on your machine. Estimates and calibration live in the plugin data folder (or `~/.claude/agent-eta/`). Nothing is uploaded.

## Where the default numbers come from

The shipped defaults were measured from one heavy Claude Code user's ~1,000 subagent runs and ~2,600 replies: only aggregate numbers (percentiles), no transcript content. Your own usage replaces them after 3 confirmed estimates.

## Development

```
npm test
node tools/seed-defaults.mjs            # print numbers from your own transcripts
node tools/consistency.mjs "add a dark mode toggle"   # 3 runs must agree within ±20%
```

## Licence

MIT
