---
name: engram
description: Fast memory audit (MCP-powered) — caps, duplicates, effectiveness, descriptions, cross-project, change tracking. Deterministic and quick. Run /engram-deep for full scan.
---

# Engram — Fast Audit

You are a memory optimization expert running the FAST audit. This is 100% MCP-powered — deterministic, consistent, and quick. No Glob/Grep scanning needed.

For the thorough audit with derivable content detection and stale reference scanning, use `/engram-deep`.

## Internal Knowledge

- **MEMORY.md** is capped at **200 lines / 25KB** — silently truncated past these limits
- **Top 5 relevance** via Sonnet side-query using the `description` frontmatter field
- **Types**: `user`, `feedback`, `project`, `reference`

## Process

### Step 1: Locate Memory

Find MEMORY.md:
1. Check `.claude/projects/<project-key>/memory/MEMORY.md`
2. Search with Glob for `**/MEMORY.md` within `.claude/`

If not found, tell the user and suggest `/engram-init` to bootstrap.

### Step 2: Read Index

Read MEMORY.md. Count lines and estimate bytes. Extract all links and read each linked file's frontmatter.

### Step 3: MCP Analysis (All Parallel)

Call these MCP tools:

1. `engram_scan_all_projects` — cross-project overview and duplicates
2. `engram_analyze_duplicates` — similarity scores between all memory pairs
3. `engram_effectiveness` — per-file effectiveness scoring
4. `engram_generate_descriptions` — auto-generated replacements for weak descriptions
5. `engram_watch_status` — recent file changes
6. `engram_get_history` — audit trend

### Step 4: Check Orphans and Dead Links

From the MEMORY.md links:
- Check each linked file exists (dead links)
- Glob for `*.md` in the memory directory, check each is linked (orphans)

### Step 5: Produce Report

```
Engram Audit (Fast)
════════════════════
MEMORY.md:  [lines]/200 lines ([pct]%) | [size]/25KB ([pct]%)
Files:      [count] linked, [orphans] orphans, [dead] dead links
Projects:   [n] with memory ([cross-dupes] cross-project duplicates)

Health:     [████████████░░░░░░░░] [GOOD/WARNING/CRITICAL] ([score]/100)

Type Distribution:
  user: [n]  |  feedback: [n]  |  project: [n]  |  reference: [n]

Effectiveness (per file):
  [filename.md]     [score]/100  [top issue]
  ...
  Average: [avg]/100

Duplicate Pairs: [n]
  [file1] <-> [file2]  [sim]%  [recommendation]
  ...

Description Improvements: [n] available
  [file.md]: "[current]" → "[suggested]"
  ...

Recent Changes:
  [changes since last check]

Audit Trend: [improving/stable/declining] (last [n] audits)

Top Recommendations:
  1. [highest impact action]
  2. [second highest]
  3. [third highest]
```

### Step 6: Save to History

Call `engram_save_audit` with project name, score, issue count, line usage, size usage, file count.

**Health Score Calculation:**
Start at 100:
- -30 if over 200-line cap
- -15 if over 150 lines
- -5 per orphan/dead link
- -3 per file with effectiveness < 40
- -2 per duplicate pair (sim > 0.4)
- -5 per cross-project duplicate
- Bonus: +5 if all 4 types present
- Bonus: +5 if avg effectiveness > 70
Clamp to 0-100.

After the report, suggest:
- `/engram-deep` for thorough scan (derivable content, stale refs)
- `/engram-optimize` to fix issues
- `/engram-suggest` to find what's missing
- `/engram-init` if memory is sparse
- `/engram-claudemd` to audit CLAUDE.md files
- `/engram-profiles` to manage memory configurations
- `/engram-log` to view changelog
