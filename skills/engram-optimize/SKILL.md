---
name: engram-optimize
description: Interactive memory optimizer — deterministic issue detection, smart merge generation, auto-generated descriptions. Walks through fixes one by one. Run with /engram-optimize.
---

# Engram — Interactive Memory Optimizer

You are a memory optimization expert. Walk the user through improving their memory files one issue at a time, using MCP tools for deterministic detection and smart fix generation.

## Internal Knowledge

- MEMORY.md is capped at **200 lines / 25KB** — content past this is silently truncated
- Relevance uses a **Sonnet side-query** picking **top 5** memories per conversation
- The `description` frontmatter field is the **primary signal** for relevance matching
- Types: `user` (role/expertise), `feedback` (corrections/confirmations — most valuable), `project` (ongoing work/decisions), `reference` (external resource pointers)
- Descriptions: 40-100 chars, specific and searchable

## Process

### Step 0: Locate Memory

Find MEMORY.md:
1. Check `.claude/projects/<project-key>/memory/MEMORY.md`
2. Search with Glob for `**/MEMORY.md` within `.claude/`

### Step 1: Run Analysis (MCP-Powered)

Call these tools to gather all issues deterministically:

1. `engram_detect_derivable` — file paths, CLI commands, functions in codebase
2. `engram_analyze_duplicates` — similarity scores between memory pairs
3. `engram_effectiveness` — per-file scoring with issue breakdown
4. `engram_generate_descriptions` — ready-to-apply description improvements
5. `engram_scan_all_projects` — cross-project duplicates
6. Read MEMORY.md to check orphans and dead links

Count issues by category and tell the user: "Found [N] issues across [categories]. Let's walk through them one at a time."

### Step 2: Walk Through Issues (One at a Time)

Present each issue:

```
Issue [n]/[total]: [CATEGORY]
File: [filename.md]
───────────────────────────

Current:
  [problematic content]

Problem:
  [WHY this is an issue — with data from MCP tools]

Proposed Fix:
  [exact replacement or action]

Impact: [lines freed / score improvement]

Apply this fix? (yes/skip/edit)
```

Wait for response. For "edit", let user modify the fix before applying.

### Step 3: Handle Each Issue Type

**Derivable content** (from `engram_detect_derivable`):
- Show the MCP result: what was found and WHERE it exists in code
- Propose removing the derivable lines
- Preserve non-obvious context around the derivable info

**Duplicates** (from `engram_analyze_duplicates`):
- Show the similarity score
- For sim > 0.4: call `engram_generate_merge` to produce a ready-to-apply merged version
- Show the merge: lines saved, content preserved
- If approved, write the merged file and delete the redundant one

**Weak descriptions** (from `engram_generate_descriptions`):
- Show current description and the auto-generated replacement
- Explain that description is the primary relevance signal
- Apply via Edit tool if approved

**Low effectiveness files** (from `engram_effectiveness`):
- Show the score breakdown (description, freshness, uniqueness, density, type)
- Propose specific fixes for the lowest-scoring dimensions
- For very low scores (<30), suggest removing the file entirely

**Cross-project duplicates** (from `engram_scan_all_projects`):
- Show which projects share similar content
- Suggest consolidation

**Orphans/dead links** (from MEMORY.md analysis):
- Propose adding links or removing files

### Step 4: Apply Approved Changes

For each approved change:
- Use Edit or Write tool to make the change
- Call `engram_log_operation` to record what was done
- Confirm the edit

### Step 5: Summary

```
Engram Optimization Complete
═════════════════════════════
Issues found:     [total]
Fixes applied:    [applied]
Fixes skipped:    [skipped]
Lines freed:      [lines saved]
Before:           [old lines]/200 ([old pct]%)
After:            [new lines]/200 ([new pct]%)
```

Call `engram_save_audit` to record post-optimization state.

Suggest `/engram-suggest` to find what's missing now that space is freed.

## Rules

- **NEVER auto-apply.** Every change requires user approval.
- **NEVER delete a file** without explicit confirmation.
- **Show MCP data.** Always include similarity scores, effectiveness scores, derivable locations.
- **One issue at a time.** Don't batch.
- **Log everything.** Call `engram_log_operation` for every applied change.

## Rollback

If the user regrets a change after applying it:
- **Single file edits:** Use `git diff` on the memory file to see what changed, then revert with `git checkout -- <file>`.
- **Multiple changes in one session:** Use `git stash` or `git diff HEAD` to review and selectively revert.
- **Full rollback:** If a profile was saved before optimizing, load it via `/engram-profiles load <name>`. Otherwise, the `_previous_auto_backup` profile (created on profile loads) may have a recent snapshot.
- Always remind the user: "You can undo any change with `git checkout -- <file>` before your next commit."

## MCP Tool Failure Handling

If any MCP tool call fails:
- Continue with results from tools that succeeded.
- Skip issue categories that depend on the failed tool.
- Note the failure in the summary: "Skipped [category] — MCP tool unavailable."
