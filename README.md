# Engram

Memory optimization plugin for [Claude Code](https://claude.ai/code). Audits, optimizes, and manages your auto-memory files.

Claude Code's memory system has hidden constraints most users don't know about. Engram knows them and helps you stay lean:

- **200-line cap** on MEMORY.md (content past this is silently invisible)
- **25KB size cap** (same — silently truncated)
- **Top 5 relevance** — only 5 memories are selected per conversation
- **Type-based filtering** — frontmatter `type` field is parsed, not decorative

## Install

```bash
claude plugin add github:btcrooks03-dot/engram
```

## Commands

### `/engram` — Full Audit

Comprehensive health report: cap usage, derivable content detection, stale references, duplicates, orphans, and a health score.

```
Engram Audit Report
═══════════════════
MEMORY.md:  87/200 lines (43%) | 4.2KB/25KB (17%)
Files:      6 memory files linked, 0 orphans, 0 dead links

Health:     ██████████░░░░░░░░░░ GOOD (72/100)
```

### `/engram-optimize` — Interactive Optimizer

Walks through every issue one by one. You approve or reject each fix. Never auto-deletes.

```
Issue 3/7: DERIVABLE CONTENT
File: athena_project.md
───────────────────────────

Current:
  - `py -m athena.main --mode backtest --csv data_cache/mes_1min_60d.csv`

Problem:
  This command exists in athena/main.py — derivable from code

Proposed Fix:
  Delete this line (the command is in the source code)

Space Saved: 1 line

Apply this fix? (yes/no/skip)
```

### `/engram-health` — Quick Validation

Structural checks only: frontmatter format, link integrity, cap compliance. Fast pass/fail checklist.

```
Engram Health Check
═══════════════════
[PASS] MEMORY.md exists
[PASS] Under line cap (87/200)
[PASS] Under size cap (4.2KB/25KB)
[PASS] All 6 links resolve
[PASS] All frontmatter valid
[PASS] MEMORY.md format clean

Result: 6/6 passed
```

### `/engram-stats` — Dashboard

Quick numbers: file counts, cap usage, type distribution, memory age.

```
Engram Stats
════════════
Memories:    6 files (2 user, 1 feedback, 2 project, 1 reference)
Index:       87/200 lines (43%)
Size:        4.2KB/25KB (17%)

Cap Usage:   ████████░░░░░░░░░░░░ 43%
```

## What It Detects

| Issue | Why It Matters |
|-------|---------------|
| **Derivable content** | File paths, CLI commands, config values that exist in your code waste precious memory space |
| **Stale references** | Mentions of deleted files or functions mislead Claude into wrong assumptions |
| **Duplicates** | Overlapping content across files wastes space and confuses relevance scoring |
| **Orphans** | Memory files not linked from MEMORY.md are invisible to Claude |
| **Dead links** | MEMORY.md entries pointing to deleted files waste index lines |
| **Bad frontmatter** | Missing or invalid name/description/type fields break relevance filtering |

## How It Works

Engram is a pure skills plugin — no MCP server, no hooks, no dependencies. Each command is a SKILL.md file that guides Claude to analyze your memory using built-in tools (Read, Grep, Glob). Install is instant, runs everywhere.

## Why These Caps Matter

Claude Code's auto-memory loads MEMORY.md into every conversation. But it's silently truncated at **200 lines** or **25KB** — whichever comes first. Content past the cap is invisible. 

Then, a **Sonnet side-query** selects only the **top 5** most relevant memory files based on the `description` field in frontmatter. If your descriptions are vague or your files are bloated with derivable content, the wrong memories get selected.

Engram helps you stay under the caps and maximize the signal density of every memory file.

## License

MIT
