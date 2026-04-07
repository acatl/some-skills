# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This repository is a collection of reusable [Agent Skills](https://github.com/anthropics/skills) for Claude Code. Skills are installed into projects via copy or symlink and load automatically based on task context. The primary activity here is **authoring, refining, and maintaining skills**.

## Commands

```bash
npm run lint              # markdownlint on all .md files
npm run lint:fix          # markdownlint autofix
npm run spellcheck        # cspell on all .md files
```

There is no build step, no test runner, and no compiled output. The repo is markdown-only.

## Quality Gates

- **Pre-commit hook** (husky + lint-staged): runs `markdownlint-cli2 --fix` then `cspell` on staged `.md` files. Every commit must pass both.
- **Markdown lint rules** ([.markdownlint.jsonc](.markdownlint.jsonc)): MD013 (line length), MD033 (inline HTML), MD034 (bare URLs), and MD047 (file-ending newline) are disabled.
- **Spell checking** ([cspell.json](cspell.json)): custom dictionary at [.cspell/dictionary.txt](.cspell/dictionary.txt). Add new technical terms there rather than using inline `cspell:ignore` comments. The dictionary is organized by category — place new words under the appropriate heading.

## Skill Authoring Standard

Every skill lives in `skills/<skill-name>/` and **must** contain a `SKILL.md` file. This is the only required file — additional files (templates, scripts, examples) are optional.

### SKILL.md Structure

```markdown
---
name: <skill-name>
description: >
  One-paragraph description of when and why to use this skill.
  This text drives Claude's decision to activate the skill — be specific
  about the trigger condition, not just what the skill does.
argument-hint: "<usage hint>" # optional — shown to user
disable-model-invocation: true # optional — require explicit /invoke
---

# <Skill Title>

<Full instructions>
```

### Frontmatter Rules

- `name` must match the directory name exactly.
- `description` is the activation signal. Write it as a **trigger condition**: "Use when the user wants to..." or "Use when a PR has...". Vague descriptions like "helps with code review" cause false activations or missed activations.
- `argument-hint` — include when the skill takes an argument (e.g., `"#<pr-number>"`).
- `disable-model-invocation: true` — set this when the skill should only run via explicit `/skill-name` invocation, never auto-activated.

### Writing Skill Instructions

Skills are prompts executed by Claude Code. They must be self-contained — Claude has no memory of prior conversations when a skill activates.

**Structural requirements:**

- Open with a **role assignment** — who Claude is acting as and what the goal is.
- Define an **execution strategy** early — what phases exist, what can be parallelized, what gates exist.
- Specify **output format** precisely — Claude will drift without a rigid template.
- Include a **"Hard Rules"** or **"Principles"** section for invariants that must hold regardless of context.
- Include a **"Common Mistakes"** table when there are known failure modes — Claude repeats mistakes that aren't explicitly called out.

**Quality criteria:**

- **Deterministic structure over vague guidance.** "Evaluate security" is weak. A numbered checklist of specific things to check with specific flag conditions is strong. Decision trees and scoring rubrics outperform prose instructions.
- **Gate irreversible actions.** Any skill that commits, pushes, creates PRs, posts comments, or modifies external state must have explicit user confirmation gates before each such action. "Never X without explicit user confirmation" must appear as a hard rule.
- **Scope control.** Skills that perform work must define what is in scope and reject out-of-scope expansion. Without this, Claude will "helpfully" expand beyond the skill's purpose.
- **Parallel execution hints.** If the skill involves multiple independent lookups or reads, include a batch diagram showing what can run in parallel. This significantly reduces execution time.
- **No delegation unless explicitly designed.** If a skill should run in the main conversation (not delegated to a sub-agent), say so explicitly. Claude will delegate to sub-agents by default for complex skills, which loses conversation context.

**Anti-patterns to avoid:**

- Generic instructions that restate Claude's default behavior ("be helpful", "write clean code").
- Instructions that depend on project-specific tooling without checking if it exists first (e.g., assuming `nx` is available).
- Mixing read-only analysis with write actions in the same phase without a gate between them.
- Omitting the output format — Claude produces inconsistent, verbose output without a rigid template.
- Using severity/verdict taxonomies without decision rules — Claude will assign them inconsistently based on vibes rather than criteria.

### Naming

- Directory names use `kebab-case`.
- Skill names should describe the action: `review-local`, `triage-pr-comments`, `start-pr-cycle`.
- Avoid generic names like `helper`, `utils`, `code-review`.

## Architecture

The three current skills form a PR workflow pipeline:

```txt
review-local          — Pre-PR self-review of local commits against origin/main
start-pr-cycle        — Orchestrates the full PR lifecycle with gates at each irreversible step
triage-pr-comments    — Triages external PR review comments with structured verdicts
```

`start-pr-cycle` invokes `review-local` as its Stage 1 and references `triage-pr-comments` for the post-review loop. They are coupled by convention (skill invocation via `/skill-name`), not by code.

Skills in this repo are designed to be **project-agnostic** — they reference project-specific tools conditionally (e.g., "if OpenSpec is present", "run the project's typecheck and test commands") rather than assuming a specific stack.
