---
name: engram-stats
description: Quick memory stats dashboard — file counts, cap usage, type distribution, age. Run with /engram-stats.
---

# Engram — Memory Stats

Display a quick stats dashboard for the user's memory system.

## Steps

1. Find and read MEMORY.md (check `.claude/projects/*/memory/MEMORY.md` or Glob search)
2. Extract all linked memory files
3. Read each file's frontmatter (name, description, type) and check file modification time
4. Count lines and estimate bytes of MEMORY.md

## Output Format

```
Engram Stats
════════════
Memories:    [n] files ([n] user, [n] feedback, [n] project, [n] reference)
Index:       [lines]/200 lines ([pct]%)
Size:        [est. bytes]/25KB ([pct]%)

Cap Usage:   [████████████░░░░░░░░] [pct]%

Files:
  [filename.md]          [type]      [age]
  [filename.md]          [type]      [age]
  ...

Oldest:      [filename] ([age])
Newest:      [filename] ([age])
Avg age:     [average] days
```

Keep it brief. This is a dashboard glance, not a full audit. If the user wants details, suggest running `/engram` for the full audit.
