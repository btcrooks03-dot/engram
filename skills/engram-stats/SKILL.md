---
name: engram-stats
description: Memory stats dashboard — cap usage, effectiveness scores, type distribution, cross-project overview, audit trend, changelog. Run with /engram-stats.
---

# Engram — Memory Stats

Display a comprehensive stats dashboard.

## Steps

### Step 1: Local Stats
1. Find and read MEMORY.md
2. Extract all linked memory files
3. Read each file's frontmatter and check modification time
4. Count lines and estimate bytes

### Step 2: MCP Data (All Parallel)
Call these tools:
- `engram_scan_all_projects` — cross-project overview
- `engram_effectiveness` — per-file effectiveness scores
- `engram_get_history` — audit trend
- `engram_watch_status` — recent changes
- `engram_get_changelog` with limit 5 — recent operations

## Output Format

```
Engram Stats
════════════
Current Project: [project-key]
Memories:    [n] files ([n] user, [n] feedback, [n] project, [n] reference)
Index:       [lines]/200 lines ([pct]%)
Size:        [est. bytes]/25KB ([pct]%)

Cap Usage:   [████████████░░░░░░░░] [pct]%

Effectiveness:
  [filename.md]     [score]/100  [type]  [age]
  ...
  Average: [avg]/100

Cross-Project Overview:
  [project-key]    [files]  [cap%]  [avg effectiveness]
  ...

Audit Trend:
  [date]  Score: [n]  Lines: [n]  Issues: [n]
  Trend: [improving/stable/declining]

Recent Operations:
  [timestamp]  [operation]  [files]  [details]
  ...

Recent Changes:
  [timestamp]  [file]  [added/modified/deleted]
  ...
```

For details, suggest `/engram` (fast audit), `/engram-deep` (thorough audit), or `/engram-log` (full changelog).
