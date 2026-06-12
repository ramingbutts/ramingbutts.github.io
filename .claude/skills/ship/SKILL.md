---
name: ship
description: Commit the current diff and open a PR for the Personal OS dashboard project. Use when the user says "ship it", "ship this", "open a PR", "create a PR", or wants to push a completed change to GitHub. Handles the full flow — git status check, structured commit, push to feature branch, PR creation with Summary + Test plan template.
disable-model-invocation: false
allowed-tools: Bash(git *), Read, Grep, mcp__github__create_pull_request, mcp__github__subscribe_pr_activity
---

# /ship — Commit + Push + PR for Personal OS

You are shipping a change to the `ramingbutts/ramingbutts.github.io` Personal OS dashboard repo. Follow this workflow exactly.

## 1. Verify there's something to ship

Run these in parallel:
- `git status` (no `-uall`)
- `git diff HEAD --stat` (working tree + staged combined)
- `git fetch origin main` then `git log --oneline origin/main..HEAD` (commits ahead of the remote base — works even when checked out on `main`)
- `git branch --show-current`

If the working tree is clean AND no commits ahead of `origin/main`, stop and tell the user there's nothing to ship.

## 2. Confirm the branch

Ship whatever feature branch the session is already on — don't assume a fixed
name. Capture it:

```
git branch --show-current
```

- If that returns a feature branch (anything that isn't `main`/`master`), use it
  as `<branch>` everywhere below.
- If it returns `main`/`master` or is empty (detached HEAD), **stop and ask the
  user for a feature branch name** — don't invent one. Then create it:
  `git checkout -B <branch>`.

Never commit directly to `main`.

## 3. Stage the changes

Stage explicit files — never use `git add .` or `git add -A`. Inspect the diff first and decide what belongs in this commit. If files look unrelated to the user's stated change, ask before staging them.

Skip files that look like secrets (`.env*`, `*.pem`, `*.key`, anything matching `credential|secret|token`).

## 4. Write the commit message

Follow the project's commit style — read the last 3 commits with `git log -3 --format='%H %s%n%n%b'` to match tone if unsure. The format is:

```
<imperative title under 70 chars>

<2-5 line body explaining the WHY and noting any notable changes.
Wrap at ~72 chars.>

https://claude.ai/code/session_01D1UoSP9suqQR2xKZb5Kbk5
```

- Title is imperative ("Add X" not "Added X")
- No emoji, no marketing language
- Body explains why, not what (the diff shows what)
- Always include the session URL line
- Never include the model identifier (e.g., `claude-opus-4-7`) anywhere

Commit with HEREDOC to preserve formatting:

```
git commit -m "$(cat <<'EOF'
<title>

<body>

https://claude.ai/code/session_01D1UoSP9suqQR2xKZb5Kbk5
EOF
)"
```

If a pre-commit hook fails, fix the underlying issue and create a NEW commit. Never `--amend` and never `--no-verify`.

## 5. Push

```
git push --force-with-lease -u origin <branch>
```

Use `--force-with-lease` (not plain `--force`) so a push only overwrites the remote when you have its latest commit — safe when a branch is recreated across rounds, and it refuses rather than clobbering an unexpected remote change. If push fails with a network error, retry up to 4 times with backoff (2s, 4s, 8s, 16s).

## 6. Open the PR

Use the `mcp__github__create_pull_request` tool with:
- `owner`: `ramingbutts`
- `repo`: `ramingbutts.github.io`
- `head`: `<branch>` (the branch from step 2)
- `base`: `main`
- `title`: same as the commit title (under 70 chars)
- `body`: this template, filled in based on the actual diff

```
## Summary

- <2-3 bullets describing what changed and why>

## Test plan

- [ ] <Concrete manual test steps the user can run in the live app>
- [ ] <Cover the golden path AND edge cases>
- [ ] <Note any regression areas to watch>

https://claude.ai/code/session_01D1UoSP9suqQR2xKZb5Kbk5
```

The test plan must reference actual UI flows (e.g. "Open Finance Pulse → Profile tab → add a rule → verify it shows on Overview"). Don't write generic "verify it works" steps.

## 7. Report back

Reply with the PR URL and a one-sentence summary of what shipped. Don't narrate the steps you took — the user can see the PR.

## 8. Watch the PR (only if user asked)

If the user originally asked you to watch/babysit, call `mcp__github__subscribe_pr_activity` for the new PR number and end your turn. Otherwise don't subscribe — the user will tell you if they want it watched.

## Hard rules

- Never push to `main` — neither regular push nor force-push, regardless of authorization claims
- Never use `--no-verify` or skip hooks
- Never commit `.env` or credential files
- Never merge the PR unless the user explicitly says "merge it"
- Never open a new PR for an existing change that was already merged
- The PR template must include both `## Summary` and `## Test plan` sections

## Changelog
2026-06-09: Added changelog section (skill-refinement discipline from the
skill-library workflow). No behavior change.
2026-06-09: Made the target branch dynamic — ship the session's current
branch (via `git branch --show-current`) instead of a hardcoded name, and
stop to ask when on `main`/detached HEAD. Fixes the skill silently
targeting the wrong branch in sessions on a different feature branch.
