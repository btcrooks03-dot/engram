---
name: engram-health
description: Quick structural validation of memory files — checks frontmatter, links, types, format, cross-project status, and cap warnings. Run with /engram-health.
---

# Engram — Memory Health Check

Quick structural validation of memory files. Lightweight checks with cross-project awareness.

## Checks

Run each check and report as a checklist:

### 1. MEMORY.md Exists
- Find MEMORY.md in the auto-memory directory (check `.claude/projects/*/memory/MEMORY.md` or search with Glob)
- PASS if found, FAIL if missing

### 2. MEMORY.md Under Caps
- Count lines (cap: 200)
- Estimate bytes (cap: 25,600 / 25KB)
- PASS if under both, WARNING if over 75% of either, FAIL if over cap

### 3. All Links Resolve
- Extract every markdown link from MEMORY.md: `[Title](filename.md)`
- Check each linked file exists in the memory directory
- PASS if all resolve, FAIL listing each dead link

### 4. All Memory Files Linked
- Glob for all `*.md` files in memory directory (excluding MEMORY.md)
- Check each is referenced in MEMORY.md
- PASS if all linked, WARNING listing each orphan

### 5. Valid Frontmatter
For each memory file, check:
- Has YAML frontmatter delimited by `---`
- Has `name` field (non-empty string)
- Has `description` field (non-empty string, under 150 chars, **at least 30 chars for effective relevance matching**)
- Has `type` field (one of: `user`, `feedback`, `project`, `reference`)
- PASS if all valid, FAIL listing each issue

### 6. MEMORY.md Format
- Each entry should be a single line under ~150 characters
- Entries should be markdown list items with links
- No raw content in MEMORY.md (it's an index, not a memory)
- PASS if clean, WARNING listing format issues

### 7. Description Quality (NEW)
- Check each memory file's `description` frontmatter field
- Descriptions under 30 chars: WARNING — too vague for relevance matching
- Descriptions that are generic ("project info", "notes", "user data"): WARNING
- PASS if all descriptions are specific and searchable

### 8. Type Coverage (NEW)
- Check if at least one memory of each type exists
- Missing `feedback` type: WARNING — corrections/confirmations are the most valuable memory type
- Missing `user` type: INFO — user context helps tailor responses
- Missing `reference` type: INFO — external resource pointers save re-explaining
- PASS if all four types are present

### 9. Cross-Project Status (MCP-Enhanced)
Call `engram_scan_all_projects` for a quick cross-project health check:
- Any other projects over 75% cap? WARNING
- Any cross-project duplicates detected? INFO
- PASS if all projects healthy

### 10. Recent Changes (MCP-Enhanced)
Call `engram_watch_status`:
- Any changes since last check? Show them.
- Any cap warnings? Flag them.

## Output Format

```
Engram Health Check v2
═══════════════════════
[PASS] MEMORY.md exists
[PASS] Under line cap (87/200)
[PASS] Under size cap (4.2KB/25KB)
[PASS] All 6 links resolve
[WARN] 1 orphan file not linked: old_notes.md
[PASS] All frontmatter valid
[PASS] MEMORY.md format clean
[WARN] 2 descriptions under 30 chars — weak relevance signal
[PASS] All 4 memory types present
[PASS] All [n] projects healthy
[INFO] 2 files modified since last check

Result: [passed]/[total] passed, [warnings] warnings

Quick actions:
  /engram           — Full audit with scoring
  /engram-optimize  — Fix issues interactively
  /engram-suggest   — Find what's missing
  /engram-claudemd  — Audit CLAUDE.md files
```
