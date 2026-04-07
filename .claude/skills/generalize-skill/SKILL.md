---
name: generalize-skill
description: >
  Use when the user wants to audit a skill for project-specific references,
  generalize it for public use, or improve its frontmatter quality. Invoke
  explicitly with a skill path: /generalize-skill skills/<skill-name>. Do NOT
  activate for general code review, markdown linting, or skill authoring
  from scratch — this skill is specifically for auditing and improving
  existing skills.
argument-hint: "skills/<skill-name>"
disable-model-invocation: true
---

# Skill Audit & Generalization

Audit an existing skill for project-specific references, generalize it for public distribution, and improve its frontmatter for reliable activation. Argument: `/generalize-skill skills/<skill-name>`. If no path given, ask.

---

You are a Staff Engineer preparing a skill for public release. Your job is to find every project-specific assumption baked into the skill and surface it for the user to decide how to handle.

**This skill is read-only until the user approves changes.**

---

## Phase 1: Audit

Read the skill's `SKILL.md` in full. Scan for every reference that ties the skill to a specific project, tech stack, or internal convention.

### What to flag

| Category | Examples |
|----------|----------|
| **Private/internal names** | Package names (`@org/pkg`), internal class names (`AppException`), project-specific constants |
| **Hard-coded paths** | `apps/api/`, `src/server/`, workspace-specific directory structures |
| **Stack assumptions** | Named frameworks (`Express`, `Next.js`, `TypeORM`), specific CLI tools (`npx nx`, `prettier`), database engines (`PostgreSQL`, `timestamptz`) |
| **Project conventions** | Specific ADR formats, named linters, commit co-author lines with model versions |
| **Disclosure risks** | Anything that reveals private infrastructure, org names, internal tooling, or proprietary patterns |

### What is NOT a finding

- References to universal tools (`git`, `gh`, GitHub API) — these are platform, not project
- Conditional references that check before assuming ("if OpenSpec is present") — already generalized
- References to other skills in this repo by `/skill-name` — these are intentional coupling

### Output

Present findings as a single table:

| # | Line(s) | Reference | Issue | Options | Recommendation |
|---|---------|-----------|-------|---------|----------------|
| 1 | ... | ... | ... | A: ... / B: ... | **A** — reason |

Rules:

- Order by severity: disclosure risks first, then hard-coded paths, then stack assumptions, then conventions
- Every finding must have at least one option and a recommendation with rationale
- If there's only one reasonable option, say "Direct fix" instead of listing options
- After the table, include an "Items that are fine as-is" section for references you examined and cleared — this shows the user you checked everything, not just what you flagged

**Gate:** "Here are my findings. Tell me which option to apply for each (e.g., '1-A, 2-B, 3-A'), or adjust any recommendations."

Do not apply changes until the user responds with their choices for every finding.

---

## Phase 2: Generalize

Apply the user's chosen option for each finding. Execute all edits, then verify with a grep for any remaining project-specific references.

### Verification

After all edits, search the file for residual references using the specific terms from Phase 1 findings. Report the result: either "Clean — no project-specific references remain" or list what was found and propose fixes.

**Do not proceed to Phase 3 until verification passes.**

---

## Phase 3: Improve Frontmatter

Evaluate the skill's YAML frontmatter against these criteria:

### `name`

- Must match the directory name exactly
- Must be `kebab-case`
- Must describe the action (not a generic noun)

### `description`

Score each dimension Yes/No:

| Dimension | Question |
|-----------|----------|
| **Trigger condition** | Does it start with "Use when..." and describe the specific situation? |
| **Negative triggers** | Does it list actions that should NOT activate this skill? |
| **Multi-line** | Is it detailed enough to prevent false activation? |
| **Scope boundary** | Does it clarify what this skill is NOT for? |

### `argument-hint`

- Present if the skill takes an argument, absent if it doesn't

### `disable-model-invocation`

- Should be `true` for skills that are expensive, destructive, or should only run on explicit invocation

### Output

Present the current frontmatter, then a proposed improved version with a brief rationale for each change. If the frontmatter is already strong, say so and skip this phase.

**Gate:** "Here's the improved frontmatter. Should I apply it?"

---

## Hard Rules

- **Never edit the skill file before the user approves findings** — Phase 1 is read-only
- **Every finding needs a user decision** — do not self-select options
- **Verify after every batch of edits** — grep for residual references
- **Do not add new functionality to the skill** — this is an audit, not a rewrite
- **Flag disclosure risks immediately** — if a private package name, org name, or internal URL is found, call it out as the first item regardless of table ordering

## Common Mistakes

| Mistake | Correct behavior |
|---------|-----------------|
| Applying "generalize" changes without user approval per finding | Present table, wait for per-finding decisions |
| Flagging universal tools (git, gh) as project-specific | Only flag tools that assume a specific project stack |
| Missing conditional references that are already properly gated | Check for "if ... exists" / "if the project uses" guards before flagging |
| Rewriting skill logic during generalization | Only change project-specific references, not the skill's structure or behavior |
| Skipping verification after edits | Always grep for residual references before declaring done |
