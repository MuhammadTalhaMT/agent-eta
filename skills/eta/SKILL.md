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

**Precise mode:** run `<cli> plan "<plan path>"`. Use its `tasks` (id, title, files) and `workflow` exactly. `phases` is `[]` (the plan already exists).

**Rough mode:** look at only:
- the file tree, 3 levels deep, skipping `node_modules`, `.git`, `dist`, `build`, `.next`
- the first 200 lines of the README, if there is one

Then split the request into 3–12 tasks, each the size of one implementer-subagent job. Number them from 1. Fill `files` with likely paths from the tree; leave it `[]` when unsure.
- If `superpowers:brainstorming` appears in your available skills: `workflow` = `"subagent-driven"`, `phases` = `["brainstorm", "spec", "plan"]`.
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

kind:
- mechanical = the spec says exactly what to write; no decisions
- integration = wiring parts together, several files, or calling an external API
- judgment = design decisions, debugging, unclear requirements, or UI that needs taste

flags (zero or more):
- manual_test = a human must check it by hand (UI look, game feel, device, real payment, email arriving)
- external_service = depends on a third-party service, API key, webhook or network
- new_dependency = installs a new package or tool

depends_on = ids of tasks whose code or output this task needs. Only real dependencies.

Tasks:
<paste: workflow, phases, and each task's id, title, files, and one-line description>
```

## 4. Run the estimate

Save the JSON to a temp file (your scratchpad if you have one, else the OS temp folder). Then:
- rough: `<cli> estimate "<json file>"`
- precise: `<cli> estimate "<json file>" --plan "<plan path>"`

If it exits with `Invalid tags: <field> …`, fix that one field and run again **once**. If it fails again, show the error and stop.

## 5. Show the result

Print the script output exactly as-is inside a code block. Add nothing before it. After it, add at most one line, only if one speed-up needs explaining (for example how to set up git worktrees).
