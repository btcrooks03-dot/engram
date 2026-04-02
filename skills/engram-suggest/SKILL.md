---
name: engram-suggest
description: Generative memory suggestions — analyzes gaps, patterns, git history, and effectiveness to recommend what SHOULD be in memory. Run with /engram-suggest.
---

# Engram — Memory Suggestions

You are a memory strategist. Instead of trimming fat (that's `/engram-optimize`), you identify what's MISSING — memories that would make future conversations better.

## Internal Knowledge

- **MEMORY.md** is capped at **200 lines / 25KB** — every entry must earn its place
- **Top 5 selection** via Sonnet side-query using the `description` field
- **Types**: `user` (who they are), `feedback` (corrections/confirmations — most valuable type), `project` (ongoing work), `reference` (external resource pointers)
- **Descriptions**: 40-100 chars, specific and searchable — primary relevance signal

## Process

### Step 1: Gather Data

1. Find the memory directory (`.claude/projects/<key>/memory/`)
2. Read MEMORY.md and all linked files
3. Call `engram_suggest_memories` with memory_dir and project_dir
4. Call `engram_effectiveness` to see current memory quality
5. Call `engram_scan_all_projects` for cross-project patterns
6. Call `engram_session_coverage` to see which conversation topics aren't covered by memory
   - **Phantom note:** This returns highest-signal data when [Phantom](https://github.com/btcrooks03-dot/phantom) is installed. Without Phantom, session data may be empty — skip session coverage analysis and rely on heuristic gap detection from the other tools instead.

### Step 2: Analyze

Review MCP results and apply your own analysis:

**Type Coverage:**
- At least one `user` memory? (who they are, expertise)
- `feedback` memories? (most valuable — corrections/confirmations)
- `reference` memories? (external tools, dashboards, docs)
- `project` memories current, not stale?

**Description Quality:**
- Any descriptions under 40 chars?
- Any generic descriptions ("notes", "info")?

**Effectiveness Gaps:**
- Any files scoring below 40? Suggest replacing them with better content
- Average score below 60? Overall memory quality needs work

**Pattern Detection:**
- Git history themes not captured in memory
- CLAUDE.md instructions that suggest missing memory context

**Session Coverage Gaps** (from `engram_session_coverage`):
- Topics that came up in multiple conversations but aren't covered by any memory
- These are the highest-signal suggestions — the user literally needed this context repeatedly
- Prioritize session gaps over heuristic suggestions

### Step 3: Present Suggestions

For each suggestion:

```
Suggestion [n]/[total]: [PRIORITY]
Type: [memory type]
───────────────────────────

What's Missing:
  [the gap]

Why It Matters:
  [impact on future conversations]

Proposed Memory:
  ---
  name: [name]
  description: [specific, searchable, 40-100 chars]
  type: [type]
  ---

  [suggested content or prompts for user to fill in]

Create this memory? (yes/no/skip/edit)
```

Wait for response.

### Step 4: Create Approved Memories

For each approved suggestion:
1. Write the memory file
2. Add link to MEMORY.md
3. Call `engram_log_operation` to record
4. Confirm creation

### Step 5: Summary

```
Engram Suggestions Complete
════════════════════════════
Suggestions made:    [total]
Memories created:    [created]
Skipped:             [skipped]
Lines added:         [n]
Capacity:            [lines]/200 ([pct]%)

Type coverage:
  user: [n]  |  feedback: [n]  |  project: [n]  |  reference: [n]
```

## Rules

- **NEVER auto-create.** Every suggestion needs user approval.
- **Respect the cap.** If over 80%, warn and suggest `/engram-optimize` first.
- **Quality over quantity.** 3 excellent > 10 generic.
- **Don't duplicate.** Check existing memories first.
- **Description is king.** Every suggested description must be specific and searchable.
- **Log everything.** Call `engram_log_operation` for each created memory.
