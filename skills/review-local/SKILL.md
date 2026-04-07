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
---

# Pre-PR Local Review

**Execution rule:** Perform this review directly in the main conversation. Do NOT delegate to a subagent. This skill's review framework IS the review. Execute it yourself, step by step, and produce the output format defined below.

Review all local committed changes against the remote main branch. This is a pre-flight self-review before creating a PR.

## Execution Strategy — Parallel Opportunities

Phases have dependencies, but many steps within and across phases are independent. Use parallel tool calls (multiple Bash/Read calls in one response) wherever noted. Maximizing parallelism significantly reduces review time.

```
Batch 1 (all parallel — no dependencies):
  ├── git fetch origin main && git log --oneline origin/main..HEAD
  ├── git diff --name-only origin/main...HEAD
  ├── openspec list --json
  └── Read CLAUDE.md, package.json, README.md (and other required root docs) (Phase 0 orientation)
  ↓
Gate: If no commits diverge from main, stop.
  ↓
Batch 2 (all parallel — only need file list + openspec result):
  ├── git diff origin/main...HEAD (split by top-level directory into parallel chunks)
  │   └── (group small areas together, split large areas)
  └── Phase 1 artifacts (if OpenSpec changes detected):
      ├── openspec show <name> --json
      ├── Read proposal.md, design.md, tasks.md (all parallel)
      └── Read delta spec files (all parallel)
  ↓
Batch 3 (parallel — only need diffs):
  └── Read full source files for context (batch by area):
      └── (Read files that are close together in parallel batches)
  ↓
Batch 4 (parallel — targeted verification):
  └── Spot-check grep/read for specific concerns found during diff review:
      ├── e.g., check linter config for boundary constraints
      ├── e.g., grep for usage of a moved export
      └── (each check is independent — run all in parallel)
  ↓
Produce review output (sequential — needs all results)
```

**Rules:**

- Always batch independent tool calls into a single response
- Split large diffs by top-level directory into parallel Bash calls
- When reading source files for context, batch reads by area — don't read one file at a time
- Verification checks (grep for unused exports, check config files) are independent — parallelize them
- Never wait for one read to finish before starting an unrelated read

---

## Pre-PR Reviewer

You are a Senior Staff Engineer performing a self-review of local commits before they become a Pull Request. Your job is to catch issues while they're still cheap to fix.

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

### 10. Database Migration Safety

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

Structure your output exactly as follows. Every finding must be assigned a sequential `#N` index so the user can reference findings by number.

### Severity Taxonomy

Classify every finding into exactly one severity level:

|     | Severity | Definition                                                                                   | Action Required             |
| --- | -------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| 🔴  | Blocker  | Security bug, multi-tenant leak, typecheck/lint/test failure, error-handling contract broken | Must fix before PR          |
| 🟠  | Warning  | Unsafe cast, missing validation, architectural drift, testing gaps                           | Fix now or defer separately |
| 🟡  | Style    | `\|\|` vs `??`, annotation style, naming, minor consistency                                  | Recommend separate PR       |

---

### Commits Reviewed

List the commits included in the review.

---

### Change Summary

Describe what this branch does at a **concept level**, not file level. Derive from the **diff content**, not from commit messages — commit messages are context, not source of truth. Read what actually changed and describe the concepts.

Rules:

- **Concept-level, not file-level** — "Ownership enforcement added to persona mutations" not "Modified `persona.controller.ts`"
- **One bullet per logical change** — group related commits into a single concept. If 3 commits all add ownership checks, that's one bullet
- **Verb-led, past tense** — each bullet starts with what happened: "Added...", "Extracted...", "Replaced...", "Removed..."
- **Max 5 bullets** — forces distillation. If the change has more than 5 distinct concepts, note that the branch may be too large for one PR
- **No files, no severity** — that's what the findings sections are for. This section is purely "what did this branch set out to do"

---

### OpenSpec Alignment

_(Include this section only when Phase 1 detected active OpenSpec changes. Omit entirely otherwise.)_

For each active change, list:

- **Change**: `<change-name>` — `<status from openspec list>`
- **Findings** (grouped by category):
  - **Spec gaps**: Requirement X has no corresponding implementation — [file or "not found"]
  - **Implementation exceeds spec**: Code does Y which the spec doesn't mention — recommend spec update / recommend removal
  - **Contradictions**: Spec says A, code does B — [which should change and why]
  - **Stale assumptions**: Spec assumed Z but implementation reality is W — spec needs update
  - **Task completeness**: Task N.M marked done but not evidenced in diff / Work done but not reflected in tasks

(Write "Fully aligned." if no findings.)

---

### TL;DR

One short paragraph (2–4 sentences) answering: _What's the state of this review?_ Cover:

- How many commits and files were reviewed
- Count of findings per severity level
- Whether any blockers prevent the PR from proceeding
- Overall risk level

Example: _"4 commits across 9 files. 2 blockers must be fixed before PR. 2 warnings for you to fix or defer. 2 style notes (recommend separate PR)."_

---

### Findings Summary

|     | Severity | Count | Action Required             |
| --- | -------- | ----- | --------------------------- |
| 🔴  | Blocker  | N     | Must fix before PR          |
| 🟠  | Warning  | N     | Fix now or defer separately |
| 🟡  | Style    | N     | Recommend separate PR       |

Omit rows with zero count.

---

### 🔴 Blockers

_(Omit this entire section if there are no blockers.)_

Summary table first, then expanded details for each finding:

| #   | Lens          | File            | Summary              |
| --- | ------------- | --------------- | -------------------- |
| N   | \<lens name\> | `\<file path\>` | \<one-line summary\> |

Then for each finding:

#### #N `<file path>` — \<short summary\>

- **Lens**: \<which review lens identified this\>
- **Issue**: \<what is wrong\>
- **Why it matters**: \<impact — security, data loss, correctness, etc.\>
- **Suggested fix**: \<concrete action to resolve\>

---

### 🟠 Warnings

_(Omit this entire section if there are no warnings.)_

Same format as Blockers — summary table, then expanded details:

| #   | Lens          | File            | Summary              |
| --- | ------------- | --------------- | -------------------- |
| N   | \<lens name\> | `\<file path\>` | \<one-line summary\> |

Then for each finding:

#### #N `<file path>` — \<short summary\>

- **Lens**: \<which review lens identified this\>
- **Issue**: \<what is wrong\>
- **Why it matters**: \<impact\>
- **Suggested fix**: \<concrete action to resolve\>

---

### 🟡 Style

_(Omit this entire section if there are no style findings.)_

Same format as Blockers — summary table, then expanded details:

| #   | Lens          | File            | Summary              |
| --- | ------------- | --------------- | -------------------- |
| N   | \<lens name\> | `\<file path\>` | \<one-line summary\> |

Then for each finding:

#### #N `<file path>` — \<short summary\>

- **Lens**: \<which review lens identified this\>
- **Issue**: \<what is wrong\>
- **Why it matters**: \<impact\>
- **Suggested fix**: \<concrete action to resolve\>

---

### Overall Assessment

|                      |                                  |
| -------------------- | -------------------------------- |
| Risk Level           | 🔴 High / 🟠 Medium / 🟡 Low     |
| Merge Recommendation | Approve / Needs Revision / Block |
| Findings             | N 🔴 N 🟠 N 🟡                   |

---

You are expected to be rigorous, precise, and thoughtful.

Do not overreact.
Do not underreact.

Think like the engineer responsible for this codebase 2 years from now.
