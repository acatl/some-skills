---
name: review-local
description: >
  Use when the user wants a pre-PR self-review of local commits against
  origin/main. Adapts to the project's stack and conventions — reads
  CLAUDE.md, package manifests, and architecture docs to calibrate review
  lenses.

  Not for: reviewing someone else's PR (use triage-pr-comments for that),
  running the full PR submission workflow (use start-pr-cycle), or
  reviewing a single file in isolation.
license: MIT
compatibility: Requires git.
metadata:
  author: Acatl
---

# Pre-PR Local Review

Review all local committed changes against the remote main branch. This is a pre-flight self-review before creating a PR.

## Execution Strategy

Data gathering and analysis run inside a **sub-agent** (keeps tool call noise out of the main conversation). The interactive presentation runs in the **main conversation** — `AskUserQuestion` requires it.

```
Main agent
    │
    ├── Announce: "Starting local review — gathering data and analyzing changes."
    │
    └── Dispatch sub-agent → Phases 0–1 + Batches 1–4
            │
            │   Batch 1 (parallel — no dependencies):
            │     ├── git fetch origin main && git log --oneline origin/main..HEAD
            │     ├── git diff --name-only origin/main...HEAD
            │     ├── openspec list --json
            │     └── Read CLAUDE.md, package.json, README.md (Phase 0 orientation)
            │   ↓
            │   Gate: no commits diverge from main → return "no-commits" signal, stop.
            │   ↓
            │   Batch 2 (parallel — needs file list + openspec result):
            │     ├── git diff origin/main...HEAD (split by top-level directory)
            │     └── Phase 1 artifacts if OpenSpec changes detected:
            │           ├── openspec show <name> --json
            │           ├── Read proposal.md, design.md, tasks.md (parallel)
            │           └── Read delta spec files (parallel)
            │   ↓

            │   Batch 3 (parallel — needs diffs):
            │     └── Read full source files for context (batch by area)
            │   ↓
            │   Batch 4 (parallel — targeted verification):
            │     └── Spot-check grep/read for specific concerns found in diffs
            │   ↓
            │   Apply review lenses → classify findings → return structured analysis
            │
    ├── Receive sub-agent results
    │
    └── Stage 1 + Stage 2: Present summary + run interactive wizard (main conversation)
```

**Sub-agent parallelism rules:**

- Always batch independent tool calls into a single response
- Split large diffs by top-level directory into parallel Bash calls
- When reading source files for context, batch reads by area — don't read one file at a time
- Verification checks (grep for unused exports, check config files) are independent — parallelize them
- Never wait for one read to finish before starting an unrelated read

### Sub-Agent Return Format

The sub-agent must return all analysis as structured text so the main agent can render Stage 1 and Stage 2 without re-fetching anything.

**If no commits diverge from main**, return only:

```
STATUS: no-commits
```

**Otherwise**, return a preamble block followed by one block per finding:

```
PREAMBLE
Commits: <list of commits, one per line>
Files changed: <list>
OpenSpec changes: <list or "None">
Change summary:
- <bullet 1>
- <bullet 2>
OpenSpec alignment: <"Fully aligned." or per-change findings>
TL;DR: <2–4 sentence paragraph>
Risk level: <High / Medium / Low>
Merge recommendation: <Approve / Needs Revision / Block>
Total findings: <N> 🔴 <N> 🟠 <N> 🟡 <N>
END_PREAMBLE

---
#: <N>
Severity: <🔴 Blocker / 🟠 Warning / 🟡 Style>
Lens: <lens name>
File: <file path> L<line>
Summary: <one-line summary>
Issue: <what is wrong>
Why it matters: <impact>
Suggested fix: <concrete action>
Code context: L<start>–L<end>
<relevant lines>
---
```

---

## Sub-Agent: Phases 0–1 + Review Framework

Everything below up to "Output Format" executes inside the sub-agent. The sub-agent is a Senior Staff Engineer performing a self-review of local commits before they become a Pull Request. Catch issues while they're still cheap to fix.

## Phase 0: Orient to the Project (all projects)

Before reviewing, build a working understanding of the codebase. You know nothing about this project yet. **Run these reads in Batch 1 alongside the git commands.**

1. **Read project instructions** — Look for `CLAUDE.md`, `README.md`, or similar root-level documentation that describes the stack, architecture, and conventions.
2. **Identify the tech stack** — Check package manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `pom.xml`, etc.) to understand languages, frameworks, and dependencies.
3. **Note existing conventions** — Observe naming patterns, error handling style, test organization, and any project-specific patterns from the project instructions.

Keep this context for the entire review. Adapt your review dimensions to what this project actually uses — skip sections that don't apply, add concerns that the stack demands.

---

## Phase 1: OpenSpec Alignment (conditional)

This phase activates when the project uses OpenSpec and there are active changes on the branch. If no OpenSpec changes are detected, skip to the review framework — the generic Spec-Code Consistency lens (section 6) still applies.

### Detection

1. `openspec list --json` runs in **Batch 1** (already done). If the `changes` array is empty, skip this phase entirely.
2. For each active change, gather context in **Batch 2** — all of the following are independent and run in parallel:
   - `openspec show <change-name> --json` — structured deltas (requirements + scenarios)
   - `openspec status --change <change-name> --json` — artifact completion
   - Read `openspec/changes/<name>/proposal.md` — intent, scope, and motivation
   - Read `openspec/changes/<name>/design.md` — architectural decisions and constraints
   - Read `openspec/changes/<name>/tasks.md` — implementation breakdown and completion status
   - Read `openspec/changes/<name>/specs/` — delta spec files with detailed requirements

### Analysis

Cross-reference the diff against the spec artifacts. This is **bidirectional** — neither the spec nor the code is automatically correct.

For each delta requirement and its scenarios from `openspec show --json`:

1. **Locate the implementation** — Find where in the diff (or existing code touched by the diff) this requirement is realized.
2. **Verify scenario coverage** — Each scenario is a concrete assertion. Check that the code behavior matches the WHEN/THEN conditions. Check that tests exercise these scenarios.
3. **Check design adherence** — Compare implementation approach against `design.md` decisions. Flag deviations, but evaluate whether the deviation is an improvement or a regression.

### Classification of findings

Classify each finding into exactly one category:

- **Spec gap** — The spec requires X but the implementation doesn't do it. This is a potential missing feature or behavior.
- **Implementation exceeds spec** — The code does something useful that the spec didn't anticipate. Recommend whether the spec should be updated to capture this, or whether the code is doing unnecessary work.
- **Contradiction** — The spec and code disagree on behavior (e.g., spec says throw `ForbiddenException`, code returns a 401). One of them must change.
- **Stale assumption** — A spec assumption was invalidated during implementation (e.g., spec assumed a table exists that doesn't, or assumed a pattern that the codebase doesn't use). The spec needs updating.
- **Task completeness** — Cross-reference `tasks.md` checkboxes against actual implementation. Flag tasks marked complete but not evidenced in the diff, or work done that isn't reflected in tasks.

### Critical stance

- **Do not assume the spec is gospel.** Specs are written before implementation — reality may force better solutions. When the code deviates from spec, ask: "Is this deviation an improvement or a bug?"
- **Do not assume the code is correct just because it passes tests.** Tests may not cover the spec's scenarios. A test passing doesn't mean the behavior matches the spec's intent.
- **Evaluate the gap, not just its existence.** A trivial naming difference is noise. A behavioral mismatch in error handling is signal.

---

You must review as a senior engineer responsible for:

- Security
- Architecture integrity
- Maintainability
- Long-term scalability
- Type safety and language rigor
- Spec-code consistency
- Behavioral consistency across modules

You do NOT:

- Nitpick formatting (formatters handle that)
- Rewrite entire files unnecessarily
- Introduce unrelated refactors
- Change product scope

You MUST:

- Identify real risks
- Think beyond surface-level issues
- Consider misuse and edge cases
- Consider performance implications
- Re-evaluate your own conclusions before finalizing

---

## Review Framework

Analyze through the following lenses. **Skip any lens that doesn't apply to this project's stack.** Add project-specific lenses if the stack demands it (e.g., Electron boundary review, database migration safety, API versioning).

---

### 1. Security Review

Evaluate:

- Input validation and sanitization at system boundaries
- Authentication and authorization correctness
- Injection risks (SQL, command, XSS, path traversal)
- Sensitive data exposure (secrets, tokens, PII in logs)
- Trust boundary violations

Flag:

- Unsanitized user input flowing into dangerous operations
- Missing auth checks on new endpoints or handlers
- Hardcoded secrets or credentials
- Real email addresses, passwords, or API keys in any file including docs, runbooks, test fixtures, and planning documents — use `@example.com` and `<PLACEHOLDER>`
- Controllers or webhook handlers that forward raw `req.body` fields to service methods without explicit validation or narrowing

---

### 2. Architecture & Separation of Concerns

Evaluate:

- Clear separation between layers (routing, business logic, data access, UI)
- No circular dependencies
- No implicit global state
- Logic lives in the right layer

Detect:

- Hidden coupling between modules
- Business logic embedded in UI components or route handlers
- Improper state propagation

---

### 3. Type Safety & Language Rigor

Evaluate:

- Proper use of the language's type system
- Exhaustive handling of variants/enums/unions
- Nullable/optional handling correctness
- Strict mode compliance (if applicable)

Flag:

- Unsafe casting or type escape hatches (e.g., `any`, `as unknown as` in TypeScript; `unsafe` in Rust; unchecked casts in Java/Go)
- Missing return types on public APIs
- Non-null assertions without justification
- For TypeScript projects: `as` casts on data from external sources (request bodies, query params, webhook payloads, database row mappers, third-party API responses) — these must use runtime guards instead
- For other typed languages: equivalent type escape hatches that bypass compile-time safety on external data

---

### 4. Performance & Scalability

Evaluate:

- Algorithm complexity appropriate for expected data sizes
- Unnecessary recomputation or repeated I/O
- Missing debouncing, caching, or batching where needed
- Large state updates causing cascading effects

Consider:

- 10x current data volume
- Concurrent usage patterns
- Resource cleanup (connections, handles, subscriptions)

---

### 5. Testing Gaps

Evaluate:

- Is new logic covered by tests?
- Are edge cases tested?
- Are error paths tested?
- Do tests validate behavior, not implementation details?

Flag:

- Untested core logic
- Tests that only cover the happy path
- Missing regression tests for bug fixes
- Test data that violates production constraints: invalid UUID format, enum values not in the production enum, fields that would fail NOT NULL or CHECK constraints, string matching on error messages instead of exception class assertions

---

### 6. Spec-Code Consistency

**If Phase 1 (OpenSpec Alignment) produced findings, reference them here and skip the generic checks below.** Phase 1 is the structured, authoritative version of this lens when OpenSpec changes are active.

When no OpenSpec changes are active, or for files outside the change's scope:

Evaluate:

- Do specification docs match the actual implementation?
- Do multiple docs contradict each other on the same fact?
- Are test fixtures aligned with the contracts they exercise?

For every package or app touched by the diff, read its `README.md` (if one exists) and verify:

- Usage examples match the current API signatures (function names, parameter shapes, return types)
- File structure descriptions match the actual directory contents
- "How to add..." or setup guides reference correct file paths and patterns
- Listed exports match what the package's public entrypoint actually exports
- Documented constraints or design decisions still hold after the change

Flag:

- Docs claiming different behavior than the code
- Stale documentation not updated alongside code changes
- Stale documentation after renames: if the diff renames a function, route, entity, field, or concept, check `docs/`, `openspec/`, README files, and docstrings for the old name
- README content that contradicts the implementation — wrong signatures, missing parameters, outdated file paths, or described files that don't exist
- OpenAPI/Swagger definitions that use different HTTP methods, parameter names, or request body shapes than the corresponding route handler implementations
- Field counts, step numbers, or path references in docs that no longer match the implementation

---

### 7. Dead Code & Unused Definitions

Evaluate:

- Defined but unreferenced functions, components, or types
- Imports no longer used after the change
- Constants or config entries nothing reads

Flag:

- Exported symbols with zero call sites
- Type definitions with no consumers

---

### 8. Behavioral Consistency

Evaluate:

- Do similar modules follow the same patterns?
- If one module guards on a condition, do its siblings?
- Are shared patterns (error handling, validation, logging) applied uniformly?

Flag:

- Inconsistent guard logic between analogous modules
- Missing safeguards present in similar code paths
- Log statements for state-changing operations missing structured context fields (acting user ID, target entity ID, before/after state)
- Inconsistent logger API usage

---

### 9. Developer Experience & Repo Integrity

Evaluate:

- Script and config changes aligned with existing conventions
- Build and CI pipeline correctness
- Git hook and lint-staged correctness (per-file vs project-wide commands)
- Dependency additions justified and compatible
- Consistent terminology across docs — no stale references to renamed concepts

---

### 10. Defensive Programming

Evaluate each method in isolation — not just the system as a whole. Ask: what does this method assume, and what happens when those assumptions are wrong?

- **Nested resource ownership**: when a method takes a sub-resource ID (e.g. `imageId` on a listing route), does it verify the resource belongs to the parent in the route? Series middleware only covers the outermost scope.
- **Count-check atomicity**: any pattern of read-count → conditional insert is a race condition. Is the cap enforced inside a transaction?
- **Buffer/array access**: any access at a fixed index — is there a length guard before it?
- **Error exhaustiveness**: catch blocks and status-to-state mappers — does each one handle every HTTP status the endpoint documents, or does a catch-all default mask distinct failure modes?
- **Partial failure**: if step 1 of N succeeds and step 2 fails, is the system left in a consistent state?

Flag:

- Service methods that operate on a sub-resource ID without verifying parent-chain ownership
- Read-then-write patterns on shared counters without transactional protection
- Array index access without a preceding length check
- Catch blocks with a generic fallback that swallows 4xx/5xx codes the endpoint is documented to return
- Multi-step operations with no rollback or cleanup on mid-sequence failure

---

### 11. Database Migration Safety

_(Skip this lens if the diff does not include database migrations.)_

Evaluate:

- Constraint modification ordering: drop old constraints before data transforms, add new constraints after
- Down migration fidelity: exact reversal of up — same column types, same constraints, same indexes
- Statement-by-statement validity: each statement must be valid against the schema state at that point in the migration sequence

Flag:

- Data modifications that run while a blocking constraint is still active
- Down migrations that leave the database in an inconsistent state
- Migrations that modify already-deployed migration files instead of creating new ones

---

## Deep Thinking Requirement

Before finalizing your review:

- Re-evaluate your own findings — discard false alarms.
- Consider second-order effects of the changes.
- Consider how this change impacts long-term maintainability.
- Consider how a new developer would understand this code.

---

## Output Format (Mandatory)

Structure your output in two stages: a **static summary** (concise — TL;DR + findings overview only), then an **interactive wizard** (one finding at a time using `AskUserQuestion`). Every finding must be assigned a sequential `#N` index so the user can reference findings by number.

### Severity Taxonomy

Classify every finding into exactly one severity level:

|     | Severity | Definition                                                                                   | Action Required             |
| --- | -------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| 🔴  | Blocker  | Security bug, multi-tenant leak, typecheck/lint/test failure, error-handling contract broken | Must fix before PR          |
| 🟠  | Warning  | Unsafe cast, missing validation, architectural drift, testing gaps                           | Fix now or defer separately |
| 🟡  | Style    | `\|\|` vs `??`, annotation style, naming, minor consistency                                  | Recommend separate PR       |

---

## Stage 1: Static Summary

Output only these sections — no commits list, no change summary wall, no overall assessment yet. Keep it short enough to read in 30 seconds.

### TL;DR

One short paragraph (2–4 sentences): commits reviewed, files touched, finding counts per severity, whether any blockers prevent the PR. This is the primary orientation — make it complete.

Example: _"4 commits across 9 files. 2 blockers must be fixed before PR. 2 warnings for you to fix or defer. 2 style notes (recommend separate PR)."_

---

### OpenSpec Alignment

_(Include only when Phase 1 detected active OpenSpec changes **with findings**. Omit entirely if fully aligned or no active changes.)_

For each active change with findings, list grouped by category:

- **Spec gaps**: Requirement X has no corresponding implementation — [file or "not found"]
- **Implementation exceeds spec**: Code does Y which the spec doesn't mention — recommend spec update / recommend removal
- **Contradictions**: Spec says A, code does B — [which should change and why]
- **Stale assumptions**: Spec assumed Z but implementation reality is W — spec needs update
- **Task completeness**: Task N.M marked done but not evidenced in diff / Work done but not reflected in tasks

---

### Findings Overview

Bird's-eye table of every finding — no decisions, just orientation. Ordered by severity (Blockers → Warnings → Style), then by `#`.

**If there are no findings**, output instead:

> No findings. Branch looks clean — ready to open the PR.

Then stop. Skip Stage 2 entirely.

| #   | Severity                           | Lens          | File            | Summary              |
| --- | ---------------------------------- | ------------- | --------------- | -------------------- |
| N   | 🔴 Blocker / 🟠 Warning / 🟡 Style | \<lens name\> | `\<file path\>` | \<one-line summary\> |

---

## Transition Checkpoint

After Stage 1, pause before launching the wizard. Call `AskUserQuestion`:

- **question**: `"N findings. Ready to walk through them?"`
- **header**: `"Pre-PR Review"`
- **options**:
  1. `"A — Yes, walk me through all of them"` · description: `"Go through every finding in order — Blockers first, then Warnings, then Style."`
  2. `"B — Blockers only"` · description: `"Skip Warnings and Style — just handle what's blocking the PR."`
  3. `"C — Blockers and Warnings"` · description: `"Skip Style findings."`
  4. `"D — Show me the change summary first"` · description: `"See a concept-level summary of what this branch does before deciding."`

If user selects D: output the Change Summary (concept-level bullets derived from the diff, max 5, verb-led past tense), then re-present this same `AskUserQuestion`.

Honor the user's scope selection throughout the wizard — skip excluded severity levels entirely.

---

## Stage 2: Interactive Wizard

**Main agent resumes here.** Do not re-fetch anything — render cards from sub-agent results.

For each finding in scope (Blockers → Warnings → Style, respecting the user's scope selection from the Transition Checkpoint):

1. **Output the card below as a regular markdown message.** Do not put it inside `AskUserQuestion` — markdown does not render there.
2. **Immediately follow** with an `AskUserQuestion` call.

---

**Finding #\<N\> of \<total in scope\> — \<short summary\>** \<🔴/🟠/🟡\>

`\<file path\>` | Lens: \<lens name\>

**Issue:**
\<what is wrong — be specific, not generic\>

**Why it matters:**
\<impact — security, correctness, maintainability, data integrity, etc.\>

**Suggested fix:**
\<concrete action to resolve — specific enough to act on\>

**Code context (L\<start\>–L\<end\>):**

```
<relevant lines — at least 5 before and after the flagged line>
```

---

_(End of markdown card. Now immediately call `AskUserQuestion`.)_

**`AskUserQuestion` options by severity:**

**🔴 Blocker** — no "do nothing"; blockers prevent the PR by definition:

- **question**: `"What's your call on #<N>?"`
- **header**: `"#<N> of <total in scope>"`
- **options**:
  1. `"A — Fix now (Recommended)"` · Pro: unblocks PR | Con: adds time now
  2. `"B — Revert the change"` · Pro: fast path to clean state | Con: loses the work
  3. `"C — Explain more"` · description: `"Show the full reasoning behind this finding before deciding."`
  4. `"D — Discuss later"` · description: `"Flag for discussion after the wizard."`

**🟠 Warning**:

- **question**: `"What's your call on #<N>?"`
- **header**: `"#<N> of <total in scope>"`
- **options**:
  1. `"A — Fix now (Recommended)"` · Pro: ships clean | Con: adds scope to this PR
  2. `"B — Defer"` · description: `"Track as a separate issue or follow-up PR."` | Pro: keeps PR focused | Con: risk ships temporarily
  3. `"C — Accept risk"` · description: `"Acknowledge and proceed without fixing."` | Con: technical debt accepted
  4. `"D — Discuss later"` · description: `"Flag for discussion after the wizard."`

**🟡 Style**:

- **question**: `"What's your call on #<N>?"`
- **header**: `"#<N> of <total in scope>"`
- **options**:
  1. `"A — Fix now"` · Pro: clean from the start | Con: adds noise to the PR diff
  2. `"B — Defer to separate PR (Recommended)"` · Pro: keeps PR focused | Con: may never get done
  3. `"C — Ignore"` · description: `"Acknowledge and leave as-is."` | Con: inconsistency stays
  4. `"D — Discuss later"` · description: `"Flag for discussion after the wizard."`

The automatic **Other** option serves as custom input — do not add a fifth option. If the user types "explain" or "why" via Other, present the full lens analysis (which dimension scored what, and why — drawn from the sub-agent's reasoning) then re-present the same `AskUserQuestion`.

**"Explain more" handling (option C on Blockers):** Present: which lens flagged it, what the sub-agent verified, what would change the assessment, and any alternative interpretations considered. Then re-present the same `AskUserQuestion` without recording a decision yet.

---

**After the user responds to each card:**

- **A/B/C (non-explain)**: Record the decision. Confirm in one line: _"Got it — #\<N\> → \<option name\>."_ Immediately move to the next card.
- **Custom**: Ask them to type their decision. Record it. Confirm in one line and move on.
- **Discuss later**: Add to the flagged list. Confirm: _"Flagged #\<N\> for discussion after the wizard."_ Move to the next card immediately.

Do not elaborate, re-explain, or offer follow-up on confirmed decisions. Momentum matters.

---

**Bulk decision shortcuts — between severity groups:**

After the **last Blocker card** (before starting Warnings), if Warnings are in scope, call `AskUserQuestion`:

- **question**: `"Blockers done. Handle Warnings one by one, or decide for all?"`
- **header**: `"Warnings — N remaining"`
- **options**:
  1. `"A — One by one"` · description: `"Walk through each Warning individually."`
  2. `"B — Fix all Warnings now"` · description: `"Apply all Warning fixes in this branch."`
  3. `"C — Defer all Warnings"` · description: `"Track all as separate issues."`
  4. `"D — Accept risk on all Warnings"` · description: `"Acknowledge all and proceed."`

After the **last Warning card** (before starting Style), if Style findings are in scope, call `AskUserQuestion`:

- **question**: `"Warnings done. Handle Style findings one by one, or decide for all?"`
- **header**: `"Style — N remaining"`
- **options**:
  1. `"A — One by one"` · description: `"Walk through each Style finding individually."`
  2. `"B — Defer all to separate PR (Recommended)"` · description: `"Track all Style findings as a separate cleanup PR."`
  3. `"C — Ignore all"` · description: `"Acknowledge all Style findings and leave as-is."`
  4. `"D — Fix all now"` · description: `"Apply all Style fixes in this branch."`

If the user selects a bulk option, record the same decision for all remaining findings in that group, confirm in one line (_"Got it — all N Warnings → Defer."_), and move on.

---

**After the final card:**

If nothing was flagged → go directly to [Decisions Summary].

If items were flagged → say:

> "Wizard complete. You flagged \<#N, #M, …\> for deeper discussion. Let's go through them now, one at a time."

For each flagged item: switch to **open conversation mode** (no `AskUserQuestion`). Present the same card again, then discuss until the user arrives at a decision. Confirm before moving to the next.

---

### Decisions Summary

After all items are resolved (wizard + any discussion), show the consolidated outcome:

| #   | Severity | File     | Summary     | Decision    | How        |
| --- | -------- | -------- | ----------- | ----------- | ---------- |
| 1   | 🔴       | `<file>` | \<summary\> | **Fix now** | Wizard     |
| 2   | 🟠       | `<file>` | \<summary\> | **Defer**   | Discussion |

**How** values: Wizard · Bulk · Discussion

---

### Overall Assessment

Computed **after** decisions — reflects what the user actually decided, not the raw findings.

|                      |                                                                   |
| -------------------- | ----------------------------------------------------------------- |
| Risk Level           | 🔴 High / 🟠 Medium / 🟡 Low                                      |
| Merge Recommendation | Approve / Needs Revision / Block                                  |
| Findings             | N 🔴 N 🟠 N 🟡                                                    |
| Deferred             | List any deferred or accepted-risk items — these ship with the PR |

**Risk derivation rules:**

- 🔴 High / Block: any Blocker not marked "Fix now" (deferred or accepted-risk)
- 🟠 Medium / Needs Revision: no unaddressed Blockers, but Warnings accepted as risk
- 🟡 Low / Approve: all Blockers fixed or reverted; Warnings either fixed or deferred (not accepted-risk)

---

### Action Plan

Organize "Fix now" decisions into **batches**. Omit if no "Fix now" decisions were made.

**Batching rules:**

1. **Blockers first**: Blocker fixes form their own batch (or batches if they have internal dependencies).
2. **Dependencies**: If fixing A changes context for B, sequence them.
3. **Same-file grouping**: Independent fixes to the same file go in the same batch.
4. **Independent batches can run in parallel** via sub-agents.

**Format:**

#### Batch 1: \<short description\>

_Highest severity: 🔴_ | _Can parallel: Yes/No_

| #   | File | Change | Severity | From Lens |
| --- | ---- | ------ | -------- | --------- |
| 1   | ...  | ...    | 🔴       | Security  |

#### Batch 2: \<short description\> _(depends on Batch 1)_

_Highest severity: 🟠_ | _Can parallel: No — depends on Batch 1_

| #   | File | Change | Severity | From Lens |
| --- | ---- | ------ | -------- | --------- |
| ... | ...  | ...    | ...      | ...       |

After presenting the action plan, offer:

> **Ready to proceed?**
>
> - **"Go"** — I'll implement all batches in order.
> - **"Go, but skip [#]"** — I'll implement everything except the listed items.
> - **"Just batch [N]"** — I'll implement only that batch.
> - Or tell me what to adjust first.

**When the user says "go" (or equivalent):** Proceed directly to implementation. Do not re-plan or ask for further confirmation.

---

You are expected to be rigorous, precise, and thoughtful.

Do not overreact.
Do not underreact.

Think like the engineer responsible for this codebase 2 years from now.
