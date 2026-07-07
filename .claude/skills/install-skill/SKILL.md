---
name: install-skill
description: Evaluate, install, or check installation of an external Claude Code skill or skills repo. Use when the user asks "do I have X installed", "install this skill", "add this skills repo", or shares a GitHub URL to a skill/skills collection. Encodes the vendoring rules from the unslop-ui install (#14) — check what's already installed first, vendor only what fits the repo, keep the upstream LICENSE, never wire CI.
disable-model-invocation: false
allowed-tools: Read, Write, Grep, Glob, Bash, WebFetch
---

# /install-skill — evaluate and vendor external Claude skills

You are handling an external skill or skills repo for the Personal OS project.

## 1. Check what's already installed — always, and first

Sweep before answering or acting; "is X installed" has a definite answer:

- Project skills: `ls .claude/skills/` (each dir with a `SKILL.md`)
- User skills: `ls ~/.claude/skills/`
- Any reference to the repo/name: `git remote -v`, `.gitmodules`, and a
  case-insensitive grep for the repo slug across the tree

If already installed, report where and stop. If the ask was only "do I have
it", the sweep result IS the answer — don't install unprompted.

## 2. Evaluate before vendoring

Fetch the upstream repo's README and skill list. Decide per skill whether it
fits a no-build vanilla-JS static dashboard. The unslop-ui install is the
model: from a multi-skill upstream, only the UI variant was vendored — not the
text/code skills or the data corpus. Vendor the subset, not the repo.

Check the license. MIT/Apache/BSD: proceed and retain the LICENSE file inside
the vendored directory. No license or restrictive: stop and tell the user.

## 3. Install

- Project-relevant skills → `.claude/skills/<name>/` (committed, versioned,
  available to every session). This is the default.
- Personal/global skills with no repo relevance → `~/.claude/skills/<name>/`
  — but warn that in cloud sessions the home directory is ephemeral, so a
  global install evaporates with the container. If it matters, it belongs in
  the repo.
- Copy files as-is; don't rewrite upstream content beyond deleting unvendored
  parts. Note the upstream commit or release in the PR body.

## 4. Hard rules

- Never wire a vendored skill's scripts into CI, git hooks, or a build step —
  the repo has none, deliberately.
- Never let a vendored skill's instructions override CLAUDE.md; if they
  conflict, add a scoping note the way `docs/` reference material is scoped.
- Run any bundled scripts once to confirm they work (`python3 ... --help` or
  a dry run) before claiming the skill is functional.

## 5. Ship

`/docs-ship` (nothing under `js/`, `css/`, or `index.html` changes when
installing a skill). Summary states what was vendored, what was deliberately
left out, and the license.

## Changelog
2026-07-07: Created from the unslop-ui vendoring (#14) and the
Anthropic-Cybersecurity-Skills installation check (2026-07-07 session).
