# Engram v2

Elite memory optimization for [Claude Code](https://claude.ai/code). MCP server + 7 skills for auditing, optimizing, suggesting, and managing your auto-memory and CLAUDE.md files.

## What's New in v2

- **MCP server** — persistent background process with 10 tools for real computation, cross-project scanning, and audit history
- **Semantic deduplication** — Jaccard similarity scoring on tokenized content, not subjective comparison
- **Cross-project awareness** — scans ALL projects' memory, detects duplicates across repos
- **Generative suggestions** — analyzes what's MISSING from memory, not just what's wrong
- **CLAUDE.md management** — audits global, project, and directory-level CLAUDE.md files
- **Memory profiles** — named snapshots for switching between workflows (debugging, feature work, etc.)
- **Git integration** — tracks memory drift over time via git history
- **Persistent audit history** — trend tracking across audits to see if optimizations helped
- **File change detection** — knows what changed since last check

## Why It Matters

Claude Code's memory system has hidden constraints:

- **200-line cap** on MEMORY.md (content past this is silently invisible)
- **25KB size cap** (same — silently truncated)
- **Top 5 relevance** — only 5 memories are selected per conversation via the `description` field
- **Type-based filtering** — frontmatter `type` field is parsed, not decorative

Engram knows these constraints and helps you maximize signal density in every memory file.

## Install

```bash
claude plugin add github:btcrooks03-dot/engram
```

After install, restart Claude Code so the MCP server registers.

## Commands

### `/engram` — Full Audit

Comprehensive health report with cross-project scanning, semantic duplicate detection, and persistent history.

```
Engram Audit Report v2
═══════════════════════
MEMORY.md:  87/200 lines (43%) | 4.2KB/25KB (17%)
Files:      6 memory files linked, 0 orphans, 0 dead links
Projects:   3 total with memory (1 cross-project duplicate)

Health:     ██████████░░░░░░░░░░ GOOD (72/100)

Type Distribution:
  user: 2  |  feedback: 1  |  project: 2  |  reference: 1

Cross-Project Duplicates:
  user_role.md (project-a) <-> user_role.md (project-b)  0.85

Top Recommendations:
  1. Merge cross-project duplicate user_role.md
  2. Improve 2 vague descriptions for better relevance matching
  3. Remove 1 derivable CLI command from project_notes.md
```

### `/engram-optimize` — Interactive Optimizer

Walks through every issue one by one with similarity scores. You approve or reject each fix.

```
Issue 3/7: DUPLICATE CONTENT (similarity: 0.72)
File: project_notes.md <-> project_context.md
───────────────────────────

Current:
  Both files describe the event automation project architecture

Problem:
  72% content overlap wastes space and confuses relevance scoring

Proposed Fix:
  Merge into single file with deduplicated content

Space Saved: 8 lines

Apply this fix? (yes/no/skip)
```

### `/engram-suggest` — Generative Suggestions (NEW)

Analyzes what SHOULD be in memory based on gaps, git patterns, and type coverage.

```
Suggestion 1/4: HIGH PRIORITY
Type: feedback
───────────────

What's Missing:
  No feedback memories found

Why It Matters:
  Feedback memories capture corrections and confirmations. Without them,
  Claude may repeat mistakes across conversations.

Proposed Memory:
  ---
  name: outlook-drafts-only
  description: All Outlook emails must be saved as drafts, never auto-sent
  type: feedback
  ---

Create this memory? (yes/no/skip/edit)
```

### `/engram-claudemd` — CLAUDE.md Audit (NEW)

Audits all CLAUDE.md files across scopes for bloat, stale content, and memory overlap.

```
Issue 2/5: OVERLAP WITH MEMORY
File: ~/.claude/CLAUDE.md
Scope: global
───────────────

Current:
  "Ben is Head of Events at M37 Ventures..."

Problem:
  45% overlap with memory file user_role.md. CLAUDE.md is for deterministic
  instructions; memory is for contextual recall. Deduplicate.

Apply this fix? (yes/no/skip)
```

### `/engram-profiles` — Memory Profiles (NEW)

Save, load, and switch between named memory configurations.

```
Engram Memory Profiles
══════════════════════
Project: -Users-bencrooks-m37-events

  debugging        7 files  2024-03-15
  feature-work     5 files  2024-03-20
  _previous_auto   6 files  2024-03-22 (auto-backup)

Commands:
  /engram-profiles save <name>
  /engram-profiles load <name>
  /engram-profiles diff <name>
  /engram-profiles delete <name>
```

### `/engram-health` — Quick Validation

Fast checklist with 4 new checks: description quality, type coverage, cross-project status, and recent changes.

```
Engram Health Check v2
═══════════════════════
[PASS] MEMORY.md exists
[PASS] Under line cap (87/200)
[PASS] Under size cap (4.2KB/25KB)
[PASS] All 6 links resolve
[PASS] All frontmatter valid
[PASS] MEMORY.md format clean
[WARN] 2 descriptions under 30 chars — weak relevance signal
[PASS] All 4 memory types present
[PASS] All 3 projects healthy
[INFO] 2 files modified since last check

Result: 8/10 passed, 1 warning, 1 info
```

### `/engram-stats` — Dashboard

Quick stats with cross-project overview, audit trend, and recent changes.

## MCP Server Tools

The MCP server runs as a background process and provides 10 tools:

| Tool | Purpose |
|------|---------|
| `engram_scan_all_projects` | Cross-project memory scanning with duplicate detection |
| `engram_analyze_duplicates` | Jaccard similarity scoring between memory files |
| `engram_suggest_memories` | Generative gap analysis and memory suggestions |
| `engram_scan_claudemd` | Multi-scope CLAUDE.md audit with memory overlap detection |
| `engram_save_audit` | Persist audit results for trend tracking |
| `engram_get_history` | Retrieve audit history and health score trends |
| `engram_watch_status` | File change detection via mtime snapshots |
| `engram_profile_save` | Snapshot current memory as a named profile |
| `engram_profile_load` | Restore a saved memory profile |
| `engram_profile_list` | List available memory profiles |
| `engram_memory_git_log` | Git-based memory drift tracking |

## What It Detects

| Issue | Why It Matters |
|-------|---------------|
| **Derivable content** | File paths, CLI commands, config values that exist in your code waste memory space |
| **Stale references** | Mentions of deleted files or functions mislead Claude |
| **Duplicates** | Overlapping content wastes space and confuses relevance scoring |
| **Cross-project duplicates** | Same content across projects — consolidate or deduplicate |
| **Orphans** | Memory files not linked from MEMORY.md are invisible to Claude |
| **Dead links** | MEMORY.md entries pointing to deleted files waste index lines |
| **Bad frontmatter** | Missing or invalid name/description/type fields break relevance filtering |
| **Vague descriptions** | Under 30 chars = weak relevance signal, wrong memories get selected |
| **Missing types** | No feedback memories = Claude repeats mistakes across conversations |
| **CLAUDE.md bloat** | Long or generic instructions dilute important behavioral rules |
| **Memory/CLAUDE.md overlap** | Duplicated content across systems wastes space in both |

## Architecture

```
engram/
  .mcp.json              — MCP server registration
  src/server.ts          — TypeScript MCP server source
  dist/server.js         — Compiled server (auto-started by Claude Code)
  skills/
    engram/              — Full audit (enhanced)
    engram-optimize/     — Interactive optimizer (enhanced)
    engram-health/       — Quick validation (enhanced)
    engram-stats/        — Dashboard (enhanced)
    engram-suggest/      — Generative suggestions (new)
    engram-claudemd/     — CLAUDE.md audit (new)
    engram-profiles/     — Memory profiles (new)
```

Skills provide the interactive UI and workflow. The MCP server provides computation, persistence, and cross-project data. Skills call MCP tools for the heavy lifting.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol
- `zod` — Schema validation
- `typescript` — Build toolchain

## License

MIT
