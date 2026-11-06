---
name: eta
description: Estimate how long a piece of Claude Code work will really take — agent time vs the user's time, a range, the biggest risk, and speed-ups. Use when the user asks "how long will this take", wants an ETA or time estimate for a feature or build, or passes a plan file to estimate.
argument-hint: <feature description | path/to/plan.md>
---

# agent-eta: estimate

You only break the work into tagged tasks. A script does all the maths. **Never invent or adjust numbers yourself.**

**CLI:** `node "<base>/../../scripts/cli.mjs"`, where `<base>` is the "Base directory for this skill" shown when this skill loaded. Run every command from the user's project directory. Below, `<cli>` means that whole `node "…/cli.mjs"` prefix.

## 1. Pick the mode

- The argument is a path to an existing `.md` file → **precise mode**.
- Anything else → **rough mode**.
- No argument → ask the user, in one question, what they want estimated. Then continue.

## 2. Build the task list

**Precise mode:** run `<cli> plan "<plan path>"`. Use its `tasks` (id, title, files) and `workflow` exactly. `phases` is `[]` (the plan already exists). The CLI drops tasks whose checkboxes are all ticked, so an estimate made mid-plan covers only the remaining work.

**Rough mode:** look at only:
- the file tree, 3 levels deep, skipping `node_modules`, `.git`, `dist`, `build`, `.next`
- the first 200 lines of the README, if there is one

Then split the request into tasks, each the size of one implementer-subagent job. Use as few tasks as the work needs: a small single change (one screen/component/endpoint) 1–3 tasks; a medium feature 3–6; a large multi-part build 6–12. One task = one user-visible capability or one cohesive change touching about 1–3 files. Merge anything under ~5 minutes of work into a neighbour. Number them from 1. Fill `files` with likely paths from the tree; leave it `[]` when unsure.
- If `superpowers:subagent-driven-development` appears in your available skills: `workflow` = `"subagent-driven"`, `phases` = `["brainstorm", "spec", "plan"]`.
- Otherwise: `workflow` = `"inline"`, `phases` = `[]`.

## 3. Tag the tasks

Dispatch one subagent with the Agent tool: `model: "haiku"`, `description: "Tag tasks for ETA"`, prompt = the tagging prompt below with the task list pasted in. If the Agent tool is unavailable, apply the same rules yourself.

```
Tag each task for a build-time estimator. Reply with ONLY one JSON object, no prose, no code fence:
{"workflow": "<keep as given>", "phases": <keep as given>, "tasks": [{"id": 1, "title": "...", "size": "S|M|L", "kind": "mechanical|integration|judgment", "flags": [], "files": [<keep as given>], "depends_on": []}]}

size:
- S = one file, small change
- M = 2–3 files, or one substantial file
- L = 4+ files, or a new subsystem
- Only tag L when the task clearly spans many files or steps; a task in a small change is rarely L.
- Precise mode: each task has a `steps` count. Read each task's body in the plan file at <plan path> before tagging. Size = the larger of the file rule above and the step rule: ≤5 steps S, 6–9 steps M, 10+ steps L.
- If torn between two sizes, pick M.

kind:
- mechanical = the spec says exactly what to write; no decisions
- integration = wiring parts together, several files, or calling an external API
- judgment = design decisions, debugging, unclear requirements, or UI that needs taste
- If torn between kinds, pick integration. Use judgment only when the request leaves the behaviour undecided (design choices, debugging an unknown cause, taste-driven UI).
- Examples: mechanical = "add a field to an existing form and its validation"; integration = "wire a new API route to the database and the UI"; judgment = "design the onboarding flow" or "find why login randomly fails".

flags (zero or more):
- manual_test = a human must check it by hand (UI look, game feel, device, real payment, email arriving)
- external_service = depends on a third-party service, API key, webhook or network
- new_dependency = installs a new package or tool

Add a flag only when it is clearly true.

depends_on = ids of tasks whose code or output this task needs. Only real dependencies.

Tasks:
<paste: workflow, phases, and each task's id, title, files, steps (precise mode), the plan path (precise mode), and one-line description>
```

## 4. Run the estimate

After the tagger replies, overwrite `workflow`, `phases` and each task's `title` and `files` in its JSON with the values you decided yourself (do not trust the tagger to echo them). Keep only the tagger's `size`, `kind`, `flags` and `depends_on`.

Write the JSON with the Write tool to a **new** file with a random suffix (for example `eta-tags-7f3k2q.json`) in your scratchpad directory if you have one, else the OS temp dir (`$TEMP` / `%TEMP%`). Never reuse an existing file and never use `/tmp`. **Wait until the Write succeeds before running the CLI**: never send the Write and the `estimate` command in the same batch of tool calls. A failed Write leaves an old file behind, and the CLI would save an estimate from those stale tags. If the Write fails, fix that and write again first.

Pass that same absolute path to the CLI with forward slashes, in double quotes. Run `estimate` **once** per request: every run saves an estimate. Then:
- rough: `<cli> estimate "<json file>"`
- precise: `<cli> estimate "<json file>" --plan "<plan path>"`

If it exits with `Invalid tags: <field> …` (nothing was saved), fix that one field in a new file and run again **once**. If it fails again, show the error and stop.

## 5. Show the result

Print the script output exactly as-is inside a code block. Add nothing before it. After it, add at most one line, only if one speed-up needs explaining (for example how to set up git worktrees). If the CLI's stderr shows a plan-file warning, mention it in one line after the output.
