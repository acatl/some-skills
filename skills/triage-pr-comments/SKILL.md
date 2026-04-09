---
name: triage-pr-comments
description: >
  Use when a PR has review comments (from Copilot, teammates, or external
  reviewers) that need structured triage before responding. Evaluates each
  comment thread with a verdict (AGREE, DECLINE, AGREE WITH MODIFICATION,
  DISCUSSION NEEDED, OUT OF SCOPE) and produces a prioritized, batched
  action plan.

  Not for: draft PRs with no comments, self-review of your own code,
  or PRs where all comments are already resolved. Not a code review tool —
  use review-local or start-pr-cycle for that.
license: MIT
compatibility: Requires git, gh (GitHub CLI), and jq.
argument-hint: "#<pr-number>"
disable-model-invocation: true
metadata:
  author: Acatl
---

# PR Comment Triage

Triage PR review comments against project standards and the PR's defined scope. Argument: `/triage-pr-comments #21`. If no number given, infer from current branch (Phase 1 step 1). If that fails, list open PRs and ask.

---

You are a Principal Engineer triaging PR review comments. Determine scope → evaluate every comment against standards and codebase → flag out-of-scope requests as separate issues → present structured triage.

**This skill is read-only.** Do NOT make code changes until the user approves the action plan.

---

## When to Use

- PR has review comments (from Copilot, teammates, or external reviewers) that need triage
- User wants a structured assessment before responding or implementing
- PR received `CHANGES_REQUESTED` and user wants to evaluate what's valid vs. noise
- User invokes `/triage-pr-comments` with or without a PR number

**Not for:** Draft PRs with no comments, self-review of your own code, PRs where all comments are already resolved.

---

## Quick Reference

**Verdicts** (attention priority order):

| Verdict                     | Meaning                                            | Output tier   |
| --------------------------- | -------------------------------------------------- | ------------- |
| DISCUSSION NEEDED           | Genuine ambiguity — cannot recommend one approach  | Attention     |
| UNCLEAR                     | Too ambiguous to evaluate — needs clarification    | Attention     |
| AGREE WITH MODIFICATION     | Issue valid, but fix should differ from suggestion | Attention     |
| AGREE (Involved/Structural) | Valid comment, complex to address                  | Attention     |
| AGREE (Mechanical/Targeted) | Valid comment, straightforward to address          | Informational |
| DECLINE                     | Technically wrong or contradicts standards         | Informational |
| OUT OF SCOPE                | Valid but belongs in a separate issue              | Informational |
| ALREADY ADDRESSED           | Fixed in current code / thread resolved            | Informational |

**Complexity levels:**

| Level      | Meaning                                       | Output tier for AGREE |
| ---------- | --------------------------------------------- | --------------------- |
| Mechanical | No design decisions — rename, guard, typo     | Informational         |
| Targeted   | Localized, clear approach — validation, logic | Informational         |
| Involved   | Multiple files or choosing between approaches | Attention             |
| Structural | Design decisions, new patterns, rethinking    | Attention             |

**Scoring dimensions** (Y/P/N): Technical Validity, Architecture Alignment, Convention Compliance, Practical Impact, YAGNI Check

---

## Execution Strategy — Parallel Opportunities

Phases have dependencies, but many steps within and across phases are independent. Use parallel tool calls (multiple Bash calls in one response) or the Agent tool with sub-agents where noted.

```
Phase 1: Resolve PR number (sequential — must complete first)
    ↓
    ├── Step 1.2: Fetch metadata ─┐
    ├── 1a: Fetch linked issues  ├── all parallel (only need PR number)
    └── 1b: Fetch diff          ─┘
    ↓
    1c: Define scope (needs results from above)
    ↓
    ┌──────────────────────────────┐
    │  Phase 2: Fetch comments     │  ← run in parallel
    │  ├── 2a: Inline comments  ─┐ │
    │  ├── 2b: Review bodies    ─┤ │  (2a/2b/2c are independent)
    │  └── 2c: Issue comments   ─┘ │
    ├──────────────────────────────┤
    │  Phase 3: Read standards     │  ← run in parallel with Phase 2
    └──────────────────────────────┘
    ↓
    Phase 4: Analyze comments (each thread is independent — parallelize via sub-agents for large PRs)
    ↓
    Phase 5: Present triage (sequential — needs all Phase 4 results)
```

**When to use sub-agents**: If Phase 2 yields more than ~5 comment threads, consider dispatching Phase 4 analysis across sub-agents (one per thread or batch of threads). Each sub-agent receives the scope statement, project standards, and its assigned comment threads, then returns verdicts. The main agent assembles the final triage.

---

## Phase 1: Resolve PR and Determine Scope

1. **Resolve the PR number** using the first method that succeeds:
   1. **Explicit argument**: If the user provided `#<number>`, use that.
   2. **Infer from current branch**: If no argument was given, get the current branch name and look up its PR:

      ```bash
      gh pr view --json number,headRefName --jq '.number'
      ```

      `gh pr view` (with no number) resolves the PR associated with the current branch. If a PR is found, use its number and continue.

   3. **Fallback — ask the user**: If the branch has no associated PR (the command above exits non-zero), list open PRs with `gh pr list` and ask the user which PR to audit.

2. Validate the PR exists and fetch metadata:

   ```bash
   gh pr view <number> --json number,title,headRefName,url,author,state,reviewDecision,body
   ```

3. If the PR is not found, report the error and stop.
4. Extract: PR number, title, branch name, URL, author, state, and review status.

### 1a. Fetch Linked Issues

Check if the PR links to any issues (these define the ticket scope):

```bash
gh pr view <number> --json closingIssuesReferences --jq '.closingIssuesReferences[]'
```

For each linked issue, fetch its title and body:

```bash
gh issue view <issue-number> --json title,body,labels
```

### 1b. Fetch the Diff

Get the actual changes in this PR to understand what was touched:

```bash
gh pr diff <number> --name-only
```

### 1c. Define the PR Scope

Construct a **scope statement** answering: _"What is this PR trying to accomplish, and what parts of the codebase does it intentionally touch?"_

Derive from (priority order): linked issue(s) → PR title/description → actual diff. Record it — Phase 4 uses it to evaluate every comment.

---

## Phase 2: Fetch Comments

**Assumption**: The user is already on the PR's branch (or in a worktree of it). All file reads use the current working directory.

**Shell/jq safety**: Use `select(.body | length > 0)` to filter empty bodies — never `select(.body != "")`. The `length > 0` form avoids the `!=` operator entirely, which the model sometimes corrupts to the Unicode not-equal character, causing a jq parse error.

Fetch all review-related comments from the PR. There are three types:

### 2a. Inline Review Comments (file-level)

```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments --paginate \
  | jq '[.[] | {id, path, line, body, user: .user.login, in_reply_to_id, diff_hunk}] | map(select(.body | length > 0))'
```

These have `path`, `line`, `body`, `user`, `in_reply_to_id`, and `diff_hunk` fields.

### 2b. Top-Level Review Bodies

```bash
gh api repos/{owner}/{repo}/pulls/<number>/reviews --paginate \
  | jq '[.[] | {id, body, state, user: .user.login}] | map(select(.body | length > 0))'
```

These have `body`, `user`, `state` (APPROVED, CHANGES_REQUESTED, COMMENTED), and `id`.

### 2c. Issue-Level Conversation Comments

```bash
gh api repos/{owner}/{repo}/issues/<number>/comments --paginate
```

These are general discussion comments on the PR.

### Processing

1. **Thread replies**: Group inline comments by `in_reply_to_id` to form threads. The root comment starts the thread; replies provide context.
2. **Detect resolved threads**: Before analyzing, check if a thread already reached resolution — the reviewer acknowledged a fix ("sounds good", "that works"), or the author confirmed completion ("done", "fixed", "addressed"). Mark these as **ALREADY ADDRESSED** without full re-analysis.
3. **Filter noise**: Skip comments that are:
   - Pure acknowledgments ("LGTM", "Thanks", "Done", thumbs-up reactions only)
   - Bot-generated status updates (CI results, auto-merge notifications)
   - Empty review bodies (reviews with `state` but no `body`)
4. **Deduplicate**: If a review body repeats what inline comments already say, keep the inline comments (they have file context).
5. **Group related comments**: If multiple comments point to the same underlying issue (e.g., three comments all about missing input validation in different handlers), group them as a single finding with multiple locations. This prevents redundant analysis and produces a cleaner action plan.

---

## Phase 3: Read Project Standards

Read the project's authoritative standards:

1. `CLAUDE.md` (project instructions and conventions)
2. Architecture docs, if present (e.g., `ARCHITECTURE.md`, `docs/architecture-spec.md`, or similar — check CLAUDE.md for pointers)
3. Any other referenced standard docs mentioned in CLAUDE.md

These documents are the authority for evaluating comments. When a review comment contradicts these standards, the standards win — unless the comment identifies a genuine bug in the standards themselves.

---

## Phase 4: Analyze Each Comment

For each comment thread (not individual replies — analyze the thread as a unit).

**Sub-agent return format**: When dispatching to sub-agents (see Execution Strategy), each sub-agent must return results in this exact structure per thread:

```
File: <path> L<line>
Reviewer: <username>
Verdict: <verdict>
Scores: TV:<Y/P/N> AA:<Y/P/N> CC:<Y/P/N> PI:<Y/P/N> YAGNI:<Y/P/N/—>
Rule: <which decision rule matched>
Complexity: <Mechanical/Targeted/Involved/Structural> (AGREE/AGREE WITH MODIFICATION only)
Dependencies: <Independent or list>
Analysis: <reasoning>
Suggested approach: <if applicable>
```

The main agent uses these to assemble the full triage output.

### 4a. Gather Context

- Read the referenced file at the relevant lines
- Read enough surrounding context to understand the code (at least 20 lines before and after)
- If the comment references other files, read those too

### 4b. Check Scope First

Compare the comment against the scope statement from Phase 1c. A comment is **OUT OF SCOPE** if it requests work beyond the PR's stated goal — untouched files, unrelated refactors, "while you're here" improvements, or functionality not in the linked issue.

**Exception**: Extra work directly related to the PR's goal is in scope (e.g., "this new endpoint needs validation" when the PR adds the endpoint).

If out of scope → assign OUT OF SCOPE, skip steps 4c–4g.

### 4c. Check Clarity

A comment is **UNCLEAR** if it's too vague to act on — no specific change requested, multiple contradictory interpretations, or incomplete thought.

If unclear → assign UNCLEAR, skip steps 4d–4g. Do not guess intent.

### 4d. Evaluate (In-Scope, Clear Comments Only)

Score the comment against five dimensions. Each dimension gets a **Yes**, **Partial**, or **No**. Record the scores — they drive the verdict in step 4f.

| #   | Dimension                  | Question to answer                                                                        | Yes                                 | Partial                                       | No                            |
| --- | -------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------- | ----------------------------- |
| 1   | **Technical Validity**     | Is the comment technically correct? Does it identify a real issue?                        | Correct and identifies a real issue | Partially correct or identifies a minor issue | Incorrect or no real issue    |
| 2   | **Architecture Alignment** | Does the suggestion align with the project's architecture (CLAUDE.md, architecture docs)? | Aligned                             | Not covered by standards (neutral)            | Contradicts standards         |
| 3   | **Convention Compliance**  | Does the suggestion follow documented conventions (naming, patterns, error handling)?     | Follows conventions                 | Not covered by conventions (neutral)          | Contradicts conventions       |
| 4   | **Practical Impact**       | Would acting on this comment meaningfully improve the code?                               | Clear improvement                   | Marginal improvement                          | No improvement or regression  |
| 5   | **YAGNI Check**            | If suggesting new functionality/abstractions: is there demonstrated usage?                | Used or not applicable              | Plausible near-term use                       | No current usage, speculative |

**YAGNI verification**: If the comment suggests adding functionality, abstractions, or "proper" implementations, grep the codebase for actual usage before scoring. If nothing calls it, score No. Unused features should not be built.

### 4e. Consider Reviewer Authority

Before assigning a verdict, note who made the comment and apply a **modifier** to borderline scores:

| Reviewer type                                  | Modifier                            | Rationale                                                                       |
| ---------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| **The user (repo owner / human partner)**      | Borderline → lean AGREE             | They own architectural decisions. Still verify technical correctness.           |
| **Team members / collaborators**               | No modifier                         | Evaluate on merit.                                                              |
| **External reviewers / drive-by contributors** | Borderline → lean DISCUSSION NEEDED | Valid points stand, but restructuring/redesign suggestions need extra scrutiny. |

**Conflict escalation**: If an external reviewer's comment contradicts a prior architectural decision made by the user, assign **DISCUSSION NEEDED** regardless of scores and explicitly flag the conflict.

### 4f. Assign Verdict

Use the dimension scores from 4d and the authority modifier from 4e to select the verdict. Follow the **decision rules** below — these are deterministic given the scores.

**Decision rules (evaluate in order — first match wins):**

1. **ALREADY ADDRESSED**: The issue described in the comment has been fixed in the current code. _(Check this first — it's a factual check, not a judgment call.)_
2. **DECLINE**: Technical Validity = No, OR Architecture Alignment = No, OR Convention Compliance = No, OR YAGNI = No.
   - _Any hard "No" on a structural dimension is a decline. One disqualifier is enough._
3. **AGREE**: Technical Validity = Yes, AND Practical Impact = Yes, AND no dimension scored No, AND the reviewer's proposed fix is the approach you would take (no clearly better alternative).
   - _The comment is correct, impactful, doesn't contradict anything, and the suggested fix is right. Act on it as suggested._
4. **AGREE WITH MODIFICATION**: Technical Validity = Yes, AND Practical Impact = Yes or Partial, AND no dimension scored No, BUT you would use a different approach than the reviewer suggested.
   - _Key distinction from AGREE: the **issue** is valid but the **proposed fix** should change. You must state what to do differently._
5. **DISCUSSION NEEDED**: Technical Validity = Yes or Partial, AND at least one of these is true:
   - Two or more dimensions scored Partial (genuine ambiguity)
   - Practical Impact = Partial and the change is Involved or Structural complexity (cost-benefit unclear)
   - The reviewer authority modifier pushed a borderline case here
   - _Key distinction from AGREE WITH MODIFICATION: you cannot confidently recommend a single approach. If you can, it's AGREE WITH MODIFICATION, not DISCUSSION NEEDED._
6. **DECLINE (marginal)**: Technical Validity = Partial, AND Practical Impact = No or Partial, AND no dimension scored Yes except possibly Architecture/Convention Alignment as neutral.
   - _Technically half-right but not worth doing._

**Tie-breaking principle**: When in doubt between two adjacent verdicts, ask: _"Can I recommend a specific action?"_ If yes → AGREE or AGREE WITH MODIFICATION. If no → DISCUSSION NEEDED. Never use DISCUSSION NEEDED as a hedge when you have enough information to decide.

_(See Quick Reference for verdict and complexity definitions.)_

### 4g. Assess Complexity and Dependencies

For AGREE and AGREE WITH MODIFICATION verdicts, assign a **Complexity** level (Mechanical / Targeted / Involved / Structural — see Quick Reference) and note **Dependencies**: which other items this depends on or conflicts with (by file + line), or "Independent" if none. If fixing A changes context for B, record the required sequence.

---

## Phase 5: Present Triage

Structure your output exactly as follows:

---

### PR Overview

| Field             | Value                       |
| ----------------- | --------------------------- |
| PR                | #\<number\> — \<title\>     |
| Branch            | \<branch-name\>             |
| Author            | \<author\>                  |
| URL               | \<url\>                     |
| Review Status     | \<reviewDecision\>          |
| Linked Issues     | \<issue numbers or "None"\> |
| Comments Analyzed | \<count\>                   |

### PR Scope

> \<The scope statement from Phase 1c — what this PR is trying to accomplish and what parts of the codebase it intentionally touches.\>

**Files changed:** \<list of files from `gh pr diff --name-only`\>

---

### TL;DR

One short paragraph (2–4 sentences) answering: _What's the state of this PR review?_ Cover:

- How many comments need action vs. how many are noise/resolved/out-of-scope
- Whether any decisions are blocking progress (DISCUSSION NEEDED / UNCLEAR)
- The highest complexity level among actionable items and how many batches the action plan has

Example: _"12 comments analyzed. 4 need action (3 Mechanical, 1 Involved), organized into 2 batches. 1 item needs your decision before the second batch can proceed. 3 out of scope, 4 already addressed."_

---

### Verdict Summary

Order follows attention priority — what needs your input first, then actionable work, then informational.

| Verdict                 | Count | Complexity Breakdown               |
| ----------------------- | ----- | ---------------------------------- |
| DISCUSSION NEEDED       | N     | — _(blocks progress)_              |
| UNCLEAR                 | N     | — _(blocks progress)_              |
| AGREE WITH MODIFICATION | N     | \<e.g., 1 Involved\>               |
| AGREE                   | N     | \<e.g., 2 Mechanical, 1 Targeted\> |
| DECLINE                 | N     | —                                  |
| OUT OF SCOPE            | N     | —                                  |
| ALREADY ADDRESSED       | N     | —                                  |

---

### Comment Analysis

Comments are organized into two tiers by attention priority. Within each tier, list comments in file order.

---

#### Needs Your Attention

_These items block progress or require your input before work can proceed._

**Verdicts in this tier** (in order): DISCUSSION NEEDED, UNCLEAR, AGREE WITH MODIFICATION, AGREE with Involved or Structural complexity.

Use the **expanded format** for each:

##### `<path>` L\<line\> — \<short summary\>

- **Reviewer**: \<username\>
- **Verdict**: \<VERDICT\>
- **Comment**: \<quoted comment text, truncated if very long\>
- **Scores**: TV:\<Y/P/N\> AA:\<Y/P/N\> CC:\<Y/P/N\> PI:\<Y/P/N\> YAGNI:\<Y/P/N/—\> → \<which decision rule matched\>
- **Analysis**: \<your reasoning — why these scores, what you verified\>
- **Complexity**: \<Mechanical / Targeted / Involved / Structural\> _(only for AGREE / AGREE WITH MODIFICATION)_
- **Dependencies**: \<"Independent" or list related items by file + line\> _(only for AGREE / AGREE WITH MODIFICATION)_
- **Suggested approach**: \<how to address it, if applicable\>
- **What's unclear**: \<explain what's ambiguous and what clarification is needed\> _(only for UNCLEAR)_

---

#### Informational

_These items are resolved, declined, deferred, or straightforward — no design decisions needed. AGREE items here are still actionable (included in the action plan) but require no judgment calls._

**Verdicts in this tier** (in order): AGREE with Mechanical or Targeted complexity, DECLINE, OUT OF SCOPE, ALREADY ADDRESSED.

Use the **compact format** — one table per verdict group:

| File     | Line   | Reviewer | Summary                                                    |
| -------- | ------ | -------- | ---------------------------------------------------------- |
| `<path>` | L\<n\> | \<user\> | \<one-sentence: what the comment says + why this verdict\> |

For contested DECLINEs (where the reasoning isn't obvious), use the expanded format instead — the reviewer may push back, so the user should see the full rationale.

---

### Decision Points

(Only if there are DISCUSSION NEEDED items)

For each DISCUSSION NEEDED item, use `AskUserQuestion` to present the trade-off and get the user's decision. Structure each decision as:

**Context:**

- What the reviewer is asking for
- What the current code does and why
- What the project standards say (if relevant)

**Options** — present 2–3 concrete options, each with explicit trade-offs:

| Option      | What it does          | Upside               | Downside                  | Complexity     |
| ----------- | --------------------- | -------------------- | ------------------------- | -------------- |
| A. \<name\> | \<brief description\> | \<concrete benefit\> | \<concrete cost or risk\> | \<complexity\> |
| B. \<name\> | \<brief description\> | \<concrete benefit\> | \<concrete cost or risk\> | \<complexity\> |
| C. \<name\> | \<brief description\> | \<concrete benefit\> | \<concrete cost or risk\> | \<complexity\> |

**Recommendation:** \<which option you'd lean toward and why — one sentence\>

After the user decides, update that item's verdict to AGREE, AGREE WITH MODIFICATION, or DECLINE accordingly, and include it in the action plan.

---

### Recommended Action Plan

After all decisions are resolved, organize the actionable items into **batches** — groups of changes that can be implemented together in one pass.

**Batching rules:**

1. **Dependencies first**: If A must happen before B, they go in separate sequential batches. A's batch comes first.
2. **Same-file grouping**: Independent changes to the same file go in the same batch (one file read, multiple edits).
3. **Complexity separation**: Structural items get their own batch — don't mix them with Mechanical items, as the design decisions may affect other changes.
4. **Independent batches can run in parallel** via sub-agents.

**Format:**

#### Batch 1: \<short description of what this batch accomplishes\>

_Complexity: \<highest complexity in the batch\>_ | _Can parallel: Yes/No_

| #   | File | Change | Complexity | From Comment   |
| --- | ---- | ------ | ---------- | -------------- |
| 1   | ...  | ...    | ...        | Reviewer @ L## |

#### Batch 2: \<short description\> _(depends on Batch 1)_

_Complexity: ..._ | _Can parallel: No — depends on Batch 1_

| #   | File | Change | Complexity | From Comment |
| --- | ---- | ------ | ---------- | ------------ |
| ... | ...  | ...    | ...        | ...          |

If all items are independent and Mechanical/Targeted, a single batch is fine — don't create artificial separation.

---

### Suggested Issues for Out-of-Scope Items

_(Only if OUT OF SCOPE items exist.)_ Draft a GitHub issue per item: title, from (reviewer + file), labels, and 2–3 sentence body with `_Originated from PR #N review — deferred as out of scope._` Ask user before creating any with `gh issue create`.

### Clarification Requests for Unclear Items

_(Only if UNCLEAR items exist.)_ Draft an in-thread reply per item: quote the comment, explain the ambiguity, ask a specific question. Ask user before posting any.

---

### Responding to Comments

(Only if the user wants to post responses after reviewing the triage)

Reply in-thread (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), not as top-level comments. No gratitude, filler, or apologies — technical substance only.

| Verdict        | Reply pattern                            | Example                                                                 |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| AGREE          | State the fix                            | "Fixed — added null guard in handler."                                  |
| DECLINE        | Lead with reasoning, reference standards | "Current impl uses X per project standards. Suggested change breaks Y." |
| AGREE WITH MOD | Acknowledge issue, explain alternative   | "Valid issue. Using \<alt\> instead because \<reason\>."                |
| OUT OF SCOPE   | Acknowledge merit, redirect              | "Tracked as #N to keep PR focused on \<scope\>."                        |
| Was wrong      | State correction factually               | "Verified — you're correct. Fixing."                                    |

---

### Next Steps

After presenting the triage, offer a clear handoff. The action plan already defines execution order (batches, dependencies, parallelism) — the user should not need to think about how to implement.

Present exactly this:

> **Ready to proceed?**
>
> - **"Go"** — I'll implement all batches in order, following the action plan above. Structural items are already separated into their own batch; any remaining decision points are listed above for your review.
> - **"Go, but skip [#]"** — I'll implement everything except the listed items.
> - **"Just batch [N]"** — I'll implement only that batch.
> - Or tell me what to adjust first.
>
> After changes are pushed, I can draft replies to the PR comments.

**When the user says "go" (or equivalent):** Proceed directly to implementation using the action plan. Do not re-plan or ask for further confirmation. The user has reviewed the triage and approved the approach.

---

## Phase 5b: Implementation Execution

Runs immediately when user approves. Batching from Phase 5 defines the strategy.

### Dispatch

| Scenario                          | Dispatch                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------- |
| Single batch, Mechanical/Targeted | Execute directly, no sub-agents                                                 |
| Multiple independent batches      | Sub-agent per batch via Agent tool (pass batch table + scope + comment context) |
| Sequential batches                | Run in order; wait for prior batch before starting next                         |
| Structural items                  | Always main agent — design decisions may affect other changes                   |

### Fix Loop

After implementing each batch:

1. Run the project's typecheck, lint, and test commands (check CLAUDE.md or `package.json` scripts for the correct invocations — e.g., `npm run typecheck`, `npm test`, or the project's equivalent).
2. If checks fail, report the specific errors and fix them before proceeding to the next batch.
3. If fixes introduce new issues beyond the original triage scope, **stop and surface them** — do not silently expand scope.

**Do not proceed to the commit gate if any check is failing.**

### Commit Gate

After all batches pass checks:

```bash
git status       # detect unrelated changes from concurrent sessions
git diff --stat  # full picture of what would be staged
```

Show the user:

- **Branch**: `<branch-name>`
- **Files to stage**: list each file with a one-line summary of what changed
- **Excluded files**: any unrelated changes visible in `git status`
- **Proposed commit message**: semantic format (`feat`, `fix`, `refactor`, etc.)

**Gate:** "Should I commit these specific files with this message?"

Wait for explicit yes. Never include files the user hasn't confirmed. Never commit without this gate, even if the user said "go" earlier — "go" authorizes implementation, not commit.

### Handoff

After commit, report what was done:

> **Triage implementation complete.**
>
> - Committed: `<commit hash>` — `<commit message>`
> - Files changed: `<count>`
> - Items addressed: `<list by # from action plan>`
> - Items skipped: `<list, if any>`
>
> Ready to push, or want to review the diff first?

If running within a `/start-pr-cycle` session, control returns to start-pr-cycle at Stage 4 (Update with origin/main) after the user confirms.

---

## Phase 6: Post-Implementation Comment Replies

This phase runs **after the user has implemented changes from the action plan and pushed them**. It is not part of the initial triage — the user triggers it explicitly (e.g., "changes are pushed, let's reply to the comments" or "draft replies").

### 6a. Verify Changes Were Pushed

Confirm the branch has been pushed with new commits since the triage:

```bash
git fetch origin <branch-name>
git log origin/<branch-name>..HEAD --oneline
```

If there are unpushed commits, remind the user to push first — replies should reference changes the reviewer can actually see.

### 6b. Map Changes to Comments

For each item in the action plan that was implemented:

1. Read the relevant file at the changed lines to confirm the fix is in place
2. Match it back to the original review comment (by file, line, and reviewer)
3. Determine which verdict category it came from (AGREE, AGREE WITH MODIFICATION, DECLINE, OUT OF SCOPE)

Also identify any action plan items that were **not** implemented — these need different handling.

### 6c. Draft Replies

For each addressed comment, draft a thread reply following the tone rules from the "Responding to Comments" section. Present all drafts in a table for quick review:

| #   | File | Reviewer | Verdict | Draft Reply     | Comment ID |
| --- | ---- | -------- | ------- | --------------- | ---------- |
| 1   | ...  | ...      | AGREE   | "Fixed — ..."   | \<id\>     |
| 2   | ...  | ...      | DECLINE | "Checked — ..." | \<id\>     |

**For items not implemented**, note them separately:

| #   | File | Reviewer | Reason Not Addressed                                    |
| --- | ---- | -------- | ------------------------------------------------------- |
| 1   | ...  | ...      | \<why — deferred, blocked, user decided against, etc.\> |

Ask the user:

> Here are the draft replies. Would you like me to:
>
> 1. Post all of them
> 2. Post specific ones (tell me which numbers)
> 3. Edit any before posting
>
> For items not addressed, would you like me to draft a reply explaining the deferral?

### 6d. Post Approved Replies

For each approved reply, post it as a thread reply to the original comment:

```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment-id>/replies -f body='<reply text>'
```

For top-level review comments that don't have a comment ID for threading, post as an issue comment:

```bash
gh api repos/{owner}/{repo}/issues/<number>/comments -f body='<reply text>'
```

After posting, confirm what was posted:

> Posted replies to N comments. Skipped M items (not addressed).

### 6e. Suggest Re-Request Review

If the PR had a `CHANGES_REQUESTED` review decision, suggest re-requesting review:

> Changes are pushed and comments are addressed. Re-request review?
>
> ```bash
> gh pr edit <number> --add-reviewer <reviewer-username>
> ```

**Important**: Do NOT re-request review automatically. Present the suggestion and wait for the user to confirm.

After the user responds (confirm or decline), output:

> **This review round is complete.**
>
> Expect more feedback — human reviewers may respond to your replies, and if you have automated
> reviewers such as Copilot, they'll run after each push. When new comments arrive, run
> `/triage-pr-comments` again to start the next round.
>
> Repeat until the PR is approved and merged.

---

## Principles

- **Standards are authority**: Project standards (CLAUDE.md, architecture docs) override reviewer opinions (unless the reviewer found a bug in the standards)
- **Scope is a boundary**: Valid suggestions outside PR scope belong in issues, not scope creep
- **YAGNI over "proper"**: Grep for actual usage before accepting new abstractions. Unused features should not be built.
- **Be honest**: If a reviewer is right, say so — don't defend code just because it's there
- **No performative language**: No "great point", no "thanks for catching" — technical substance only
- **User-driven actions**: Phases 1–5 are read-only. Every externally-visible action (code changes, issues, replies, pushes) requires user approval first.
- **Thread-first**: Read the full thread before analyzing any comment — replies often refine or resolve the original point
- **"Go" means go**: When approved, proceed directly — do not re-plan or re-confirm
