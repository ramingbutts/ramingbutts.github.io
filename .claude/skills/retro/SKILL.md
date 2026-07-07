---
name: retro
description: Mine recent repo activity for repeated workflow patterns and encode them as skills or CLAUDE.md updates. Use when the user asks to "find patterns in my sessions", "what do I keep repeating", "turn my workflow into skills", "audit my skills", or requests a retrospective on how they've been working with Claude. This is the meta-loop behind /ship (#5), the skills batch (#11), and the 2026-07-07 retro.
disable-model-invocation: false
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, mcp__github__list_pull_requests, mcp__github__pull_request_read
---

# /retro — turn repeated work into skills

You are mining this repo's history for patterns worth automating.

## 1. Know what the evidence actually is

Cloud sessions are ephemeral — past session transcripts do NOT persist in the
container, so "read my sessions" cannot be taken literally. The durable
record, in order of usefulness:

- PR history (`mcp__github__list_pull_requests`, state=all): every Claude PR
  body links its session and describes the ask. This is the closest thing to
  a transcript archive.
- `git log --all` over the window, including direct-to-main work that never
  got a PR (the Level 1 iterations were only visible here).
- `.claude/skills/` — what's already been extracted; don't re-extract it.
- The current session itself.

Say plainly which sources you used and that transcripts weren't among them.
And fetch `origin/main` first — the container's clone is stale by days.

## 2. Count, don't vibe

A pattern is a workflow shape that appears 3+ times with the same structure.
For each candidate, cite the concrete evidence (PR numbers, commit subjects).
Two occurrences is a coincidence to mention, not a skill to write.

## 3. Extract, respecting the North Star

- Already covered by an existing skill → say so; consider a Changelog-noted
  refinement to that skill instead of a new one.
- Genuinely recurring and mechanical → a new skill under `.claude/skills/`,
  matching the house format: frontmatter (name, trigger-rich description,
  disable-model-invocation, allowed-tools), numbered workflow, hard rules
  where the history shows a failure mode, and a `## Changelog` section whose
  first entry cites the evidence the skill came from.
- Behavioral rather than mechanical → a line in CLAUDE.md, not a skill.
- Cap the batch at what the evidence supports. Manufacturing skills to hit a
  requested count is the over-engineering the North Star forbids.

## 4. Report the inefficiencies too

The valuable half of a retro is what the history shows going wrong: reworked
themes, unchecked test plans, stale open PRs, prompts assuming context a
fresh session can't have. Name the biggest one with its evidence, and one
concrete change the user can make to their prompting.

## 5. Ship

`/docs-ship` — a retro only touches `.claude/` and docs.

## Changelog
2026-07-07: Created during the 30-day retro that produced iterate-level,
apply-doc-insights, install-skill, and docs-ship; the /ship origin (#5) and
skills batch (#11) show the loop recurring before that.
