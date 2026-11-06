# agent-eta — Design Spec

**Date:** 2026-11-06
**Status:** Draft for review
**Type:** Public Claude Code plugin

## Problem

Ask Claude "how long will this take?" and it answers in human-developer hours. With Claude Code — subagents, agentic workflows — typing is nearly free. Real time goes to:

1. Waiting on the human (questions, approvals, manual testing)
2. Verification (builds, tests)
3. Sequential task chains
4. Rework (review loops, spec gaps)

agent-eta estimates build time the way it actually unfolds with Claude Code, learns from its own accuracy, and suggests how to make the build faster.

## Goals

- Estimate from a plain description (**rough mode**) or a plan file (**precise mode**).
- Split the estimate into **agent time** (user can walk away) and **user time** (user must be present).
- Show a range and the single biggest risk.
- Suggest concrete **speed-ups** with minutes saved.
- Learn from estimate-vs-actual, per user, locally.
- Work for a brand-new user with no history (shipped defaults).

## Non-goals (v0.1)

- Monte Carlo simulation
- Status-line display
- Team-shared calibration
- Uploading any data anywhere

## Output format

```
Total: 1h 10m – 1h 50m (wall clock)
  Agents working:   ~50 min   (you can walk away)
  You needed:       ~25 min   (3 approvals, 1 manual test)
  Biggest risk:     Task 3 — Stripe webhooks (+30 min if it fails)

Speed-ups (−25 min):
  • Tasks 2 & 4 are independent → run in parallel worktrees (−15 min)
  • 3 approvals spread across the build → answer them up front (−10 min wait)
  • Tasks 1, 5 are mechanical → use a cheaper model (lower cost, ~same time)

Calibration: default numbers (2 more confirmed estimates until personal)
```

## Architecture

### Plugin layout

```
agent-eta/
  .claude-plugin/plugin.json
  .claude-plugin/marketplace.json
  commands/eta.md            /eta <description | plan path>
  commands/eta-done.md       /eta-done [estimate id]  — mark latest open estimate finished
  commands/eta-stats.md      /eta-stats               — accuracy history + active corrections
  skills/estimate/SKILL.md   decomposes + tags tasks, calls scripts, formats output
  scripts/estimate.mjs       tagged tasks → minutes, range, risk (pure maths, no AI)
  scripts/speedups.mjs       tagged tasks + estimate → ranked speed-up tips
  scripts/measure.mjs        lazy: finds finished estimates, measures actuals, updates calibration
  scripts/lib/transcripts.mjs  transcript reading helpers
  data/defaults.json         shipped starting numbers
  tools/seed-defaults.mjs    dev-only: builds defaults.json from the author's transcripts
  test/                      node:test suites + fixture transcripts
```

**No hooks.** Learning is lazy (see Learning).

### User data location

`${CLAUDE_PLUGIN_DATA}` if the environment variable is set, otherwise `~/.claude/agent-eta/`.

- `estimates.jsonl` — one record per estimate
- `calibration.json` — per-user corrections
- `errors.log` — script failures

### Runtime

Node.js (`.mjs`, no dependencies). Node is already present wherever Claude Code runs. Must work on Windows, macOS and Linux paths.

## Flow: `/eta`

1. **Lazy learning first:** run `measure.mjs` (see Learning). Fast no-op when nothing is open.
2. **Get tasks:**
   - **Precise mode** (argument is an existing `.md` file): parse `### Task N:` headings, their `**Files:**` lists, and step checkboxes.
   - **Rough mode** (anything else): Claude reads only the file tree (depth 3) and README, then decomposes the description into 3–12 tasks. If the `superpowers:brainstorming` skill is installed, add the up-front phases: brainstorm, spec, plan.
3. **Tag tasks.** A cheap/fast-model subagent produces JSON:
   ```json
   {
     "workflow": "inline" | "subagent-driven",
     "phases": ["brainstorm", "spec", "plan"],
     "tasks": [
       {
         "id": 1,
         "title": "Stripe webhook handler",
         "size": "S" | "M" | "L",
         "kind": "mechanical" | "integration" | "judgment",
         "flags": ["manual_test", "external_service", "new_dependency"],
         "files": ["src/billing/webhook.ts"],
         "depends_on": []
       }
     ]
   }
   ```
   `workflow` is `subagent-driven` when the plan header names `subagent-driven-development`, else `inline`.
4. **Compute:** `estimate.mjs` → numbers; `speedups.mjs` → tips.
5. **Print** the output block.
6. **Save** the record to `estimates.jsonl`: id, session id, project dir, start timestamp, mode, plan path (if any), tags, predicted numbers, status `open`.

## Estimation maths (`estimate.mjs`)

All constants come from `defaults.json`, multiplied by `calibration.json` corrections when active.

### Agent minutes per task

```
agent_i = base[kind][size] × workflow_factor + (new_dependency ? dep_minutes : 0)
```

- `base`: 3×3 table (kind × size), seeded from real subagent run durations: S ≈ p25, M ≈ p50, L ≈ p75.
- `workflow_factor`: inline 1.0; subagent-driven seeded (≈1.8 — implementer + spec review + quality review + fix loops).
- `new_dependency`: additive minutes (≈3), seeded.

### User minutes

- **Active:** per phase gate (brainstorm ≈2 min/question × `brainstorm_questions` (default 5, seeded), spec review ≈5, plan review ≈5), per `manual_test` 5 / 10 / 15 for S / M / L.
- **Reply delay:** median gap between Claude asking and the user replying, per gate and per manual test. Seeded; personalised by learning.

### Wall clock

Tasks run sequentially (lanes = 1).

```
wall = Σ agent_i + Σ user_active + Σ reply_delay
```

### Range and risk

Per-task spread multiplier: mechanical 1.3, integration 1.8, judgment 2.5; × 1.5 if `external_service`.

```
low   = wall × 0.85
extra_i = agent_i × (spread_i − 1)
high  = wall + sqrt(Σ extra_i²)
risk  = task with max extra_i
```

## Speed-ups (`speedups.mjs`)

Each tip's saving is computed by re-running `estimate.mjs` with the change applied, so numbers stay consistent. Show at most 3 tips, each saving ≥ 5 min (cost-only tips exempt), sorted by saving.

| Rule | Condition | Change modelled |
|---|---|---|
| Parallel worktrees | ≥2 tasks with no `depends_on` path between them **and** no shared `files` | lanes = 2 on those tasks; + merge overhead (≈3 min per extra lane) |
| Front-load decisions | user gates spread across ≥2 points in the build | reply delays collapse to one |
| Batch manual tests | ≥2 `manual_test` tasks | test reply delays collapse to one at the end |
| Cheaper model | ≥1 `mechanical` task | no time change; marked "lower cost" |

Parallel tips must state the condition (separate worktrees), because superpowers forbids parallel implementers in one tree.

## Learning (`measure.mjs`, lazy)

Runs at the start of every `/eta` and `/eta-stats`. No hooks.

### 1. Detect finished estimates (for each `open` record)

In order of trust:

1. `/eta-done` was run → done time = when it ran.
2. Precise mode and every `- [ ]` in the plan is now `- [x]` → done time = plan file's last-modified time.
3. Open > 14 days → status `unconfirmed`, never used for learning.

### 2. Measure actuals

Read transcripts in the project's Claude Code transcript folder (`~/.claude/projects/<encoded project path>/`), including `<session>/subagents/*.jsonl`, between start and done time:

- **User time:** gap between the last assistant entry and the next real user prompt (not tool results).
- **Agent time:** all remaining active time.
- **Breaks:** any gap > 30 min is removed from both.
- **Per-task (precise mode):** match subagent dispatch descriptions to plan task titles (case-insensitive substring) → actual minutes per task → updates that task's `kind×size` cell. Unmatched tasks only contribute to the total.

### 3. Update calibration

- Corrections per `kind×size` cell, `workflow_factor`, and the user's reply delay.
- `new = old + 0.3 × (actual/predicted × old − old)`, with each update's ratio clamped to [0.5, 2.0].
- Corrections apply only after **3 confirmed estimates**; until then the output says "default numbers".
- `defaults.json` is never modified.

## `/eta-stats`

Last 10 confirmed estimates: predicted vs actual, error %. Average error. Active corrections. Count of open/unconfirmed.

## Seeding defaults (`tools/seed-defaults.mjs`, dev-only)

Reads the author's local transcripts (~1,200 subagent runs) and writes `data/defaults.json`. **Only aggregate numbers** go into the file — no transcript text, file names or project names. README states defaults come from one heavy user and that learning personalises them.

## Error handling

- Invalid tag JSON → script exits non-zero naming the bad field; skill retries tagging once, then reports the error.
- Missing/unreadable transcripts → estimate marked `unconfirmed`, logged to `errors.log`; `/eta` still produces an estimate.
- Corrupt `calibration.json` → ignored with a one-line warning; defaults used.
- No script ever blocks or crashes a session.

## Testing

- `node --test` for all scripts, no dependencies.
- `estimate.mjs`: fixed tags → exact minutes; range formula; risk selection; inline vs subagent-driven.
- `speedups.mjs`: parallel rule respects `depends_on` and shared `files`; savings equal estimate deltas; max 3 tips; ≥5 min threshold.
- `measure.mjs`: fixture transcripts → agent/user split; 30-min break removal; checkbox detection; 14-day expiry; 0.3 update step; clamp; 3-estimate minimum.
- Windows path handling tested first.
- Consistency eval (`claude plugin eval`): same description tagged 3 times → estimates within ±20%.
- Dogfood: author uses it on 5 real builds before public release.

## Release

GitHub repo with `.claude-plugin/marketplace.json`; install via `/plugin marketplace add <owner>/agent-eta`. Version 0.1.0. README covers usage, output meaning, privacy (all local), and where defaults come from.
