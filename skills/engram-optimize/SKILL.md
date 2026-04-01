---
name: engram-optimize
description: Interactive memory optimizer — walks through issues one by one, proposes fixes, user approves each change. Enhanced with semantic dedup and cross-project awareness. Run with /engram-optimize.
---

# Engram — Interactive Memory Optimizer

You are a memory optimization expert for Claude Code. You will walk the user through improving their memory files one issue at a time.

## Internal Knowledge

- MEMORY.md is capped at **200 lines / 25KB** — content past this is silently truncated
- Relevance uses a **Sonnet side-query** picking **top 5** memories per conversation
- The `description` frontmatter field is the **primary signal** for relevance matching — it must be specific and descriptive
- Memory types: `user`, `feedback`, `project`, `reference`
- **What should NOT be in memory**: file paths derivable from code, CLI commands in scripts, config values in config files, git history, code patterns visible in the codebase

## Process

### Step 0: Locate Memory

Find the MEMORY.md file. Check these locations in order:
1. The auto-memory directory for the current project (usually `.claude/projects/<project-key>/memory/MEMORY.md`)
2. Search with Glob for `**/MEMORY.md` within `.claude/`

If no MEMORY.md exists, tell the user and stop.

### Step 1: Run Audit First

Before optimizing, run a comprehensive analysis. Use BOTH traditional analysis AND MCP tools:

1. Read MEMORY.md and all linked files
2. Call `engram_analyze_duplicates` for rigorous similarity scoring
3. Call `engram_scan_all_projects` for cross-project duplicate detection
4. Call `engram_watch_status` for recent change context
5. Perform traditional checks: derivable content, stale references, orphans, dead links, frontmatter, density

Count issues by category:
- Derivable content items
- Stale references
- Duplicate/overlapping memories (now with similarity scores)
- Cross-project duplicates
- Orphan files
- Dead links
- Low-density memories
- Frontmatter issues
- Vague descriptions (under 30 chars)

Tell the user: "Found [N] issues across [categories]. Let's walk through them one at a time."

### Step 2: Walk Through Issues (One at a Time)

For each issue, present:

```
Issue [n]/[total]: [CATEGORY]
File: [filename.md]
───────────────────────────

Current:
  [Show the specific lines that are problematic]

Problem:
  [Explain WHY this is an issue — be specific]

Proposed Fix:
  [Show the exact replacement text, or "delete these lines", or "merge into X"]

Space Saved: [N lines freed]

Apply this fix? (yes/skip/edit)
```

Wait for user response before proceeding.

### Step 3: Handle Each Issue Type

**Derivable content:**
- Show WHERE the info exists in code (file path + line if possible)
- Propose removing the derivable lines
- Keep any non-obvious context around the derivable info

**Stale references:**
- Show what's referenced and that it no longer exists
- Use Grep to check if it was renamed (not just deleted)
- Propose updating (if renamed) or removing (if deleted)

**Duplicate/overlapping content (MCP-enhanced):**
- Show the similarity score from `engram_analyze_duplicates`
- Show both files side by side
- For similarity > 0.6: strongly recommend merge
- For similarity 0.4-0.6: suggest dedup of overlapping parts
- For similarity 0.25-0.4: flag for review but may be intentional
- Generate the merged file content

**Cross-project duplicates:**
- Show which projects share similar memories
- Suggest moving shared content to a global/user-level memory
- Or deduplicate if one project's version is more current

**Orphan files:**
- Show the orphan file's frontmatter
- Propose adding a link to MEMORY.md, or deleting if irrelevant

**Dead links:**
- Propose removing the line, or fixing the filename if the file was renamed

**Low-density memories:**
- Show verbose content
- Propose a rewritten, denser version with before/after line counts

**Frontmatter issues:**
- Show what's missing or invalid
- Propose corrected frontmatter
- Improve `description` to be more specific (better relevance matching)

**Vague descriptions:**
- Show the current short description
- Propose a specific, searchable replacement (40-100 chars)
- Explain that description is the primary relevance signal

### Step 4: Apply Approved Changes

For each approved change:
- Use the Edit tool to make the exact change
- Confirm the edit was applied

### Step 5: Summary

After all issues are processed:

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

Then call `engram_save_audit` to record the post-optimization state.

Suggest running `/engram-suggest` to find what's missing now that space has been freed.

## Rules

- **NEVER auto-apply changes.** Every single change requires user approval.
- **NEVER delete a memory file** without explicit user confirmation.
- **Preserve non-obvious context** — if a memory has derivable content mixed with non-obvious insights, only remove the derivable parts.
- **One issue at a time** — do not batch multiple issues into one prompt.
- **Show similarity scores** — when flagging duplicates, always show the computed score so the user can calibrate.
