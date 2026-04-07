---
name: start-pr-cycle
description: >
  Use when the user explicitly asks to run the full PR cycle, submit a PR,
  or go through the PR workflow. This skill orchestrates pre-PR review,
  fix, commit, update, push, and PR creation as a single guided session
  with hard confirmation gates at each irreversible step. Do NOT activate
  for partial actions like "commit this", "push my branch", "review my
  code", or "create a PR" — those are individual operations, not the full
  cycle. Only activate when the user wants the entire end-to-end workflow.
license: MIT
compatibility: Requires git and gh (GitHub CLI). Requires review-local and triage-pr-comments skills.
metadata:
  author: Acatl
---

# PR Cycle

Orchestrates the full PR workflow with hard gates at every irreversible step.
Never auto-advances past a gate. User must confirm each stage explicitly.

## Stages

### Pre-PR flow

| From                       | To                         | Condition                                    |
| -------------------------- | -------------------------- | -------------------------------------------- |
| [0] Orient                 | [1] Review (/review-local) | Branch confirmed                             |
| [1] Review (/review-local) | [2] Fix                    | User selects findings to fix                 |
| [1] Review (/review-local) | [3] Commit                 | No findings                                  |
| [2] Fix                    | [1] Review                 | New findings surface during fix              |
| [2] Fix                    | [3] Commit                 | All blockers resolved, no new findings       |
| [3] Commit                 | [4] Update                 | User confirms files and message              |
| [4] Update                 | [4] Update (retry)         | Merge conflicts — resolve, then re-merge     |
| [4] Update                 | [5] Push                   | Checks pass after merge (or merge was no-op) |
| [4] Update                 | [2] Fix                    | Checks fail after merge                      |
| [5] Push                   | [6] Create PR              | User confirms push, PR does not exist yet    |
| [5] Push                   | [6a] CI Watch              | PR already exists (CI-fail fix loop)         |
| [6] Create PR              | [6a] CI Watch              | User opts in                                 |
| [6] Create PR              | Done                       | User declines CI watch                       |
| [6a] CI Watch              | [2] Fix                    | CI fails, user approves fix scope            |
| [6a] CI Watch              | Done                       | CI passes                                    |

### Post-review flow

`/triage-pr-comments` owns triage → fix → commit. `start-pr-cycle` resumes at Stage 4.

| From                                    | To            | Condition                                    |
| --------------------------------------- | ------------- | -------------------------------------------- |
| /triage-pr-comments (triage + fix + commit) | [4] Update    | User confirms commit in triage skill         |
| [4] Update                              | [5] Push          | Checks pass after merge (or merge was no-op) |
| [4] Update                              | /triage-pr-comments | Checks fail after merge — new triage round |
| [5] Push                                | [6a] CI Watch     | User opts in                                 |
| [5] Push                                | [7] Learn         | User declines CI watch                       |
| [6a] CI Watch                           | /triage-pr-comments | CI fails — new triage round              |
| [6a] CI Watch                           | [7] Learn         | CI passes                                    |

---

## Stage 0 — Orient (always first)

```bash
git branch --show-current
git status
git log origin/main..HEAD --oneline
```

**Gate:** Show branch name and ask: "Is this the right branch? Should I proceed?"

Stop if the user says no. Never assume the stated branch matches the current branch.

---

## Stage 1 — Review

Invoke `/review-local` using the Skill tool (skill: "review-local"). This is mandatory — do NOT delegate the review to a subagent. The `/review-local` skill must execute directly in the main conversation. It is a purpose-built review framework that adapts to the project's stack and conventions — generic code review agents miss project-specific patterns.

**Severity taxonomy — use this consistently:**

| Severity    | Definition                                                                                   | Default action                                              |
| ----------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Blocker** | Security bug, multi-tenant leak, typecheck/lint/test failure, error-handling contract broken | Must fix before proceeding. Do not advance to commit.       |
| **Warning** | Unsafe cast, missing validation, architectural drift                                         | Present to user, ask whether to fix now or track separately |
| **Style**   | `\|\|` vs `??`, annotation style, naming                                                     | Mention briefly; recommend fixing in a separate PR          |

**Gate:** After presenting findings, ask: "Which findings should I fix? (Blockers are required — list others you want addressed.)"

Do not self-select which warnings or style issues to fix. The user decides scope.

---

## Stage 2 — Fix

Fix only what the user approved in Stage 1 gate.

- Run the project's typecheck, lint, and test commands (as identified in Phase 0 orientation) after fixes
- If new findings surface, loop back to Stage 1 — present them, gate again
- Do NOT silently expand scope during fixing

**Do not advance to Stage 3 if any blocker remains unresolved.**

---

## Stage 3 — Commit

```bash
git status       # to detect unrelated changes from concurrent sessions
git diff --stat  # full picture of what would be staged
```

Show the user:

- **Branch**: `<branch-name>`
- **Files to stage**: list each file with a one-line summary of what changed
- **Excluded files**: any unrelated changes visible in `git status`
- **Proposed commit message**: semantic format (`feat`, `fix`, `refactor`, etc.)

**Gate:** "Should I commit these specific files with this message?"

Wait for explicit yes. Never include files the user hasn't confirmed.

Commit format:

```
<type>(<scope>): <description>
```

---

## Stage 4 — Update with origin/main

```bash
git fetch origin main
git merge origin/main
```

If conflicts arise, present them to the user and resolve before continuing.

After merge, re-run the project's typecheck, lint, and test commands on affected files.

- If checks pass (or the merge was a no-op) → proceed to Stage 5.
- If checks fail → loop back to Stage 2 (Fix) with the specific errors.

---

## Stage 5 — Push

**Gate:** "Should I push `<branch>` to `origin/<branch>`?"

Wait for explicit yes before running `git push -u origin <branch>`.

---

## Stage 6 — Create PR

Check for OpenSpec context first:

```bash
openspec list --json
```

If active changes exist, read `openspec/changes/<name>/proposal.md` for the Summary section.
Do NOT add artifact links manually — if the project has an OpenSpec PR linker CI job, it adds them automatically.

Before drafting the PR body, check whether a **Setup & Manual Testing** section is needed. Include it when any of the following apply:

- New environment variables or secrets must be configured (API keys, tokens, credentials)
- External vendor or third-party service setup is required (accounts, webhooks, dashboards)
- Infrastructure changes need manual action (Render service config, DB migrations outside CI)
- Key behaviors cannot be verified by automated tests alone (OAuth flows, email delivery, payment hooks)
- Reviewer needs to run the server or hit endpoints manually to verify correctness

If none apply, omit the section entirely. Use numbered steps for sequential actions.

Show the user the full PR title and body draft before creating.

**Gate:** "Should I create this PR?"

Wait for explicit yes, then:

```bash
gh pr create --title "<semantic-title>" --body "$(cat <<'EOF'
## Summary
<bullets from proposal.md or commit context>

## Test plan
- [ ] All checks pass (typecheck, lint, test)
- [ ] [behavior-specific items from the change]

<!-- If applicable, add the section below. Otherwise delete it. -->
## Setup & Manual Testing

### Prerequisites
1. [Step to configure env var, API key, or external service]
2. [Additional setup step if needed]

### Manual Verification
1. [First step — e.g., start the server, open the dashboard]
2. [Specific action to take — curl command, UI flow, endpoint test]
3. [Confirm expected outcome]

EOF
)"
```

Return the PR URL.

---

## Stage 6a — CI Watch (optional)

After push, offer: **"Want me to watch CI and triage any failures?"**

If the user declines, no further action needed. If they accept:

### 1. Find the CI run

```bash
gh run list --branch <branch> --limit 1 --json databaseId,status,event --jq '.[0]'
```

If no run is found yet, wait a few seconds and retry once — CI may not have triggered yet.

### 2. Watch in background

```bash
gh run watch <run-id> --exit-status
```

Run this using the Bash tool's `run_in_background` parameter (not shell `&`). Claude Code will notify you when the command completes.

### 3. When CI completes

You will be notified when the background command finishes via Claude Code's background task notification.

**If CI passed:** Report "CI passed" — no action needed.

**If CI failed:** Triage the failure:

```bash
gh run view <run-id> --log-failed 2>&1 | tail -100
```

Present a triage table:

| #   | Job          | Failure Type                    | Summary            | Action                            |
| --- | ------------ | ------------------------------- | ------------------ | --------------------------------- |
| 1   | \<job name\> | lint / typecheck / test / build | \<one-line error\> | Fix needed / Pre-existing / Flaky |

For each failure that needs fixing:

- If it's caused by changes in this branch → loop back to **Stage 2 (Fix)** with the specific errors
- If it's pre-existing (exists on main too) → note it but don't block the PR
- If it looks flaky (passed locally, intermittent) → suggest re-running: `gh run rerun <run-id> --failed`

**Gate after triage:** "CI had failures. Here's what I found — which should I fix?"

Do not auto-fix CI failures without user confirmation on scope.

---

## Stage 7 — Learn (after review comments addressed)

This stage runs after the PR has received external review, the comments have been triaged via `/triage-pr-comments`, accepted findings have been implemented, and fixes have been committed. It extracts patterns from what was accepted and feeds them back into project standards to prevent recurrence.

**When to activate:** The user says "let's learn from this review" or equivalent, or triggers this stage after pushing fixes from a review round. Do not auto-activate — the user may want to adjust the audit before learning from it.

### 7a. Gather Accepted Patterns

Identify which PR review comments were classified as **AGREE** or **AGREE WITH MODIFICATION** during the `/triage-pr-comments` triage. For each, extract the **underlying pattern** — the class of mistake, not the specific fix.

Example: A comment that said "this webhook handler casts the payload with `as` instead of validating" → pattern is "unsafe `as` cast on external data."

Skip comments that are purely mechanical (typos, missing imports, formatting) — these don't represent learnable patterns.

### 7b. Classify Against Existing Rules

For each extracted pattern, search `CLAUDE.md` and the `review-local` skill's `SKILL.md` (locate it via `find . -path "*/review-local/SKILL.md"`) for existing rules that cover it.

**Search strategy:**

1. Identify 3–5 keywords from the pattern (e.g., "as cast", "external data", "webhook", "runtime validation")
2. Search both files for those keywords
3. Read the surrounding section to determine if the existing rule covers this specific scenario

**Classification:**

| Category             | Definition                                                                                                          | Action                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Repeated offense** | An existing rule in CLAUDE.md or review-local already covers this class of mistake, but the code violated it anyway | Reinforce the existing rule (7c)          |
| **New pattern**      | No existing rule covers this class of mistake                                                                       | Draft a new rule and propose to user (7d) |
| **Already captured** | An existing rule already covers this with sufficient specificity                                                    | Skip — no action needed                   |

### 7c. Reinforce Existing Rules (automatic)

For repeated offenses, strengthen the existing rule. Reinforcement strategies (pick the most appropriate):

- **Add specificity**: If the rule is general ("validate inputs"), add the specific boundary that was missed ("validate inputs at system boundaries including webhook payloads")
- **Add an example**: If the rule lacks a concrete example, add one matching the pattern
- **Elevate prominence**: If the rule is buried in a long list, consider whether it should be its own bullet or subsection

Apply reinforcements directly — these are existing rules being strengthened, not new policy. Show the user what was reinforced for transparency but do not gate on approval.

### 7d. Propose New Rules (requires user approval)

For genuinely new patterns, draft a rule following these requirements:

**Writing style:**

- Match the voice and format of existing CLAUDE.md and review-local entries
- Use imperative mood ("Never use...", "Always validate...", "Throw, never catch...")
- Be generic — reference the class of mistake, not the specific PR or file
- Include a concrete example where it aids clarity (use the same inline format as existing rules)

**Placement:**

- Identify the correct section of CLAUDE.md and/or the correct lens in review-local
- If no existing section fits, propose a new section name and placement

**Gate:** Present all proposed new rules together:

> **New patterns detected from this review cycle:**
>
> 1. **[Section/Lens]**: [proposed rule text]
> 2. **[Section/Lens]**: [proposed rule text]
>
> These are new rules not currently in project standards. Which should I add?

Wait for the user to approve, modify, or reject each proposed rule. Only add approved rules.

### 7e. Apply Changes

1. Edit `CLAUDE.md` with the approved changes
2. Run the project's formatter on the modified files
3. Run the project's markdown linter if one is configured
4. Show the user a summary of what was added/reinforced

Do not commit these changes automatically — they will be included in the next commit cycle (the user may want to bundle them with other changes or commit separately).

---

## Hard Rules

These rules apply at every stage and cannot be overridden by urgency:

- **Never commit without explicit user confirmation of exactly which files**
- **Never push without explicit user confirmation**
- **Never create a PR without explicit user confirmation of title and body**
- **Never advance past a blocker** — blockers are not skippable
- **Never fix issues outside the user-approved scope** — ask before expanding
- **"Just go" / "I've already checked it" is not confirmation** — still gate

---

## Common Mistakes

| Mistake                                                           | Correct behavior                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| Advancing to commit because no blockers were found                | Still gate — user must confirm files to stage            |
| Fixing all warnings because they're "obviously right"             | Ask the user which warnings to fix                       |
| Including unrelated staged changes in the commit                  | List them explicitly and ask whether to include or stash |
| Assuming the stated branch is the current branch                  | Always run `git branch --show-current` first             |
| Auto-generating the PR body from commits without showing it first | Always show draft and gate before `gh pr create`         |
