# Project: raphail369.me (GitHub Pages)

## Implementation Notes Protocol

When working on a task, evaluate whether it warrants implementation notes. **Skip notes entirely** for:
- Single-file edits under ~20 lines
- Config changes, typo fixes, dependency bumps
- Tasks where every decision was explicit in the request

**Create or append to `implementation-notes.md`** when any of these apply:
- The task required interpreting an ambiguous or incomplete spec
- A design decision was made that could reasonably have gone another way
- Something was intentionally left out or deferred
- A tradeoff was made (performance vs readability, scope vs timeline, etc.)
- The implementation deviates from what was asked and why
- External constraints forced a change (browser compat, library limitations, API quirks)

### Notes format

Append each entry under a date + task heading. Keep every bullet to one sentence.

```
## YYYY-MM-DD — [short task description]

**Decisions made:**
- [what was decided and why, one line each]

**Deviations from spec:**
- [what changed from the original ask and why]

**Tradeoffs:**
- [what was traded for what]

**Open questions:**
- [anything the user should weigh in on]
```

Omit any section that has no entries — don't include empty headings.
