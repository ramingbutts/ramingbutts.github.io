---
name: apply-doc-insights
description: Apply the transferable principles from an external document (whitepaper, system prompt, operating manual, blog post) to this repo. Use when the user shares or names a document and asks to "apply", "adopt", "distill", "extract insights from", or "learn from" it — e.g. an Anthropic paper, a model's system prompt, an engineering guide. Encodes the flow used for the agents whitepaper (#9/#10), the Fable 5 working-style distillation (#13), and the Opus 4.8 operating manual (#15).
disable-model-invocation: false
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(git *)
---

# /apply-doc-insights — external document → scoped repo changes

You are adapting an external document's ideas to the Personal OS repo. The
repeated mistake this skill prevents is wholesale adoption: most of any such
document describes a different product and does not transfer.

## 1. Locate the document

Verify it exists before anything else — an uploaded attachment, a `docs/`
file, or a URL. If the user references a document that isn't actually present,
say so and stop; don't reconstruct it from memory.

## 2. Triage every idea into three buckets

Read the whole document, then sort its claims:

- **Transfers** — applies to a no-build vanilla-JS static dashboard and isn't
  already covered by CLAUDE.md. These become changes.
- **Already covered** — CLAUDE.md, an existing skill, or existing code already
  says it. Name where; make no change.
- **Doesn't transfer** — assumes a different product (agents, chat UI, tools,
  build pipelines). Explicitly skipped. Past PRs earned their value by what
  they declined: #9 skipped multi-agent machinery because the paper's own
  "match complexity to value" said to.

The North Star in CLAUDE.md outranks the document. When they conflict, the
document loses, and the writeup says so.

## 3. Apply, in the right layer

- Behavioral guidance for Claude → a scoped edit to CLAUDE.md. Keep it short;
  distill, don't paste. Check the new text against every existing CLAUDE.md
  section for contradictions before writing.
- Runtime improvements → normal code changes following Conventions (Storage.set
  only, Diag for failures, `_esc()` for user content).
- The document itself worth keeping → archive it verbatim under `docs/` and add
  a "reference, not operating instructions" scoping note to CLAUDE.md, the way
  `docs/claude-fable-5-system-prompt.md` is handled. Verbatim means
  byte-for-byte; note the line count so drift is detectable.

## 4. Ship

Use `/docs-ship` if only docs/CLAUDE.md changed, `/ship` otherwise. The PR
summary must list the skipped bucket, not just the applied one — that's the
evidence the triage happened.

## Changelog
2026-07-07: Created from the pattern across PRs #9/#10 (agents whitepaper),
#12/#13 (Fable 5 prompt archive + distillation), and #15 (Opus 4.8 manual).
