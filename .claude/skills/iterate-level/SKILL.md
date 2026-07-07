---
name: iterate-level
description: Run one numbered iteration pass on a Unicorn Janitor game level. Use when the user asks for the next iteration, a themed pass (e.g. "polish pass", "mobile QA", "perf pass", "combat juice"), or any change under games/unicorn-janitor/. Encodes the iteration loop used 13 times on Level 1 — read PATTERNS.md first, one theme per pass, exit criteria before code, numbered commit, PATTERNS.md updated with what was learned.
disable-model-invocation: false
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(git *), Bash(node *)
---

# /iterate-level — one numbered iteration on a game level

You are running a single themed iteration on a Unicorn Janitor level, the way
Level 1 was built (iterations 1–13). One theme per pass; don't mix a perf pass
with a content pass.

## 1. Load state before touching code

- Read `games/unicorn-janitor/PATTERNS.md` end to end. It is the source of
  truth for locked decisions (character designs, content note, rendering rig,
  CFG conventions). Never re-litigate something marked locked.
- Find the current iteration number:
  `git log --oneline -- games/unicorn-janitor/ | grep -io "iteration [0-9]*" | head -1`.
  This pass is N+1.
- Skim the level's JS for the `CFG` block — tuning goes through `CFG`, not
  magic numbers scattered in functions.

## 2. Pin the theme and exit criteria FIRST

Before writing code, state in one or two sentences: the theme of this
iteration, and 2–4 concrete checks that mean it's done (e.g. "fog sprites no
longer read as bokeh on portrait phones", "load-to-playable under 50 ms").
History shows the cost of skipping this: character models took three separate
passes (iterations 3, 8, 13) because "done" was never pinned. If the user gave
only a vibe ("make it feel AAA"), translate it into checks and show them —
don't ask, just state the interpretation and proceed.

## 3. Implement within house constraints

- No build step, no new dependencies. Three.js modules are vendored under
  `games/unicorn-janitor/lib/` — extend from there.
- Audio is procedural WebAudio, no asset files.
- Content note applies: camp and flamboyant, never group-targeting labels.
- Extract shared code on the second use, not before (design-for-evolution).

## 4. Verify

There is no test suite. At minimum run `node --check` on every changed JS
file, then walk the exit criteria from step 2 one by one and report each as
verified, not-verified, or needs-manual-check-in-browser. Never imply a
criterion passed when it wasn't checked — unchecked boxes are the repo's
known failure mode.

## 5. Record and commit

- Append a section to `PATTERNS.md` for anything reusable learned this pass
  (the file's existing sections are the format: what the trick is, the tuned
  values, the lesson/caveat). Skip this only if genuinely nothing transfers.
- Commit as: `Level <L> iteration <N>: <short theme>` — matching the existing
  series. Body lists the exit criteria and their verification status.
- Ship via `/ship` if the user wants a PR; Level 1 iterations were merged
  directly, so ask only if the destination is ambiguous.

## Changelog
2026-07-07: Created from the Level 1 iteration history (13 passes,
2026-07-03 → 2026-07-07), including the repeated-rework lesson from
iterations 3/8/13.
