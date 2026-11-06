---
name: eta-done
description: Mark the latest agent-eta estimate for this project as finished, so the plugin measures the real time from transcripts and learns. Use when the user says the estimated work is done, or asks to close an estimate.
argument-hint: [estimate id]
---

# agent-eta: done

Run from the user's project directory:

`node "<base>/../../scripts/cli.mjs" done [id]`

`<base>` is the "Base directory for this skill" shown when this skill loaded. Pass an id only if the user gave one.

Print the output as-is in a code block. Add nothing else.
