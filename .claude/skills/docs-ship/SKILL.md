---
name: docs-ship
description: Ship a docs-, CLAUDE.md-, or .claude-only change (no runtime code touched). Use when committing/PR-ing a change whose diff contains no js/, css/, or index.html edits — README updates, CLAUDE.md edits, docs/ archives, skill installs. Wraps /ship with the no-runtime-impact regression note and a test plan that can actually be executed, replacing the ritual unchecked checklists of past docs PRs.
disable-model-invocation: false
allowed-tools: Bash(git *), Read, Grep, mcp__github__create_pull_request
---

# /docs-ship — ship a change with no runtime impact

A thin layer over `/ship` for the repo's most common PR shape (README #7,
archive #12, working-style #13, manual #15): only `docs/`, `CLAUDE.md`,
`README.md`, or `.claude/` changed.

## 1. Prove the claim before making it

Run `git diff origin/main...HEAD --stat` (plus `git status --short` for
uncommitted work) and confirm no path under `js/`, `css/`, or `index.html` is
touched. If anything runtime IS in the diff, this skill doesn't apply — use
plain `/ship` and write a real functional test plan.

## 2. Then follow /ship, with two substitutions

Everything in `/ship` applies (branch rules, explicit staging, commit format,
force-with-lease push, PR template, hard rules). Substitute:

**Regression line** — the Summary ends with the verified sentence: "Diff
touches only `<actual paths>` — nothing under `js/`, `css/`, or `index.html`,
so the live dashboard is unaffected." Only write it because step 1 proved it.

**Test plan** — 2–4 checks executable in this session, and execute them
before opening the PR, marking each `[x]` or `[ ]` honestly:

- Referenced paths resolve (`ls` each file path the new text cites).
- Markdown renders sanely (headings/links well-formed — a grep for broken
  `](` targets covers most of it).
- CLAUDE.md edits don't contradict an existing section (read the whole file
  once after editing).
- Anything genuinely needing a human (e.g. "confirm it renders on the live
  site after deploy") stays `[ ]` with a note that it's the user's step —
  but that should be the minority. Past docs PRs shipped fully-unchecked
  plans and merged inside a minute; the point of this skill is that checked
  boxes were actually run.

## Changelog
2026-07-07: Created from the docs-only PR pattern (#7, #12, #13, #15) and
the unchecked-test-plan failure mode visible in their merge timestamps.
