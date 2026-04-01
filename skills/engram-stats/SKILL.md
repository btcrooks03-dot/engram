---
name: engram-stats
description: Memory stats dashboard — file counts, cap usage, type distribution, age, cross-project overview, audit trend. Run with /engram-stats.
---

# Engram — Memory Stats

Display a comprehensive stats dashboard for the user's memory system.

## Steps

### Step 1: Local Stats
1. Find and read MEMORY.md (check `.claude/projects/*/memory/MEMORY.md` or Glob search)
2. Extract all linked memory files
3. Read each file's frontmatter (name, description, type) and check file modification time
4. Count lines and estimate bytes of MEMORY.md

### Step 2: Cross-Project Overview (MCP-Enhanced)
Call `engram_scan_all_projects` to get stats across ALL projects with memory.

### Step 3: Audit Trend (MCP-Enhanced)
Call `engram_get_history` for the current project to show health score trend.

### Step 4: Recent Changes (MCP-Enhanced)
Call `engram_watch_status` with the memory directory to show recent file changes.

## Output Format

```
Engram Stats
════════════
Current Project: [project-key]
Memories:    [n] files ([n] user, [n] feedback, [n] project, [n] reference)
Index:       [lines]/200 lines ([pct]%)
Size:        [est. bytes]/25KB ([pct]%)

Cap Usage:   [████████████░░░░░░░░] [pct]%

Files:
  [filename.md]          [type]      [age]     [lines]
  [filename.md]          [type]      [age]     [lines]
  ...

Oldest:      [filename] ([age])
Newest:      [filename] ([age])

Cross-Project Overview:
  [project-key]    [files]  [cap%]  [status]
  [project-key]    [files]  [cap%]  [status]
  ...

Audit History:
  [date]  Score: [n]  Lines: [n]  Issues: [n]
  [date]  Score: [n]  Lines: [n]  Issues: [n]
  Trend: [improving/stable/declining]

Recent Changes:
  [timestamp]  [file]  [added/modified/deleted]
  ...
```

If the user wants details, suggest `/engram` for full audit, `/engram-suggest` for suggestions, or `/engram-claudemd` for CLAUDE.md analysis.
