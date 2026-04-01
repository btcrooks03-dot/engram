---
name: engram-health
description: Quick structural validation of memory files — checks frontmatter, links, types, format. Run with /engram-health.
---

# Engram — Memory Health Check

Quick structural validation of memory files. No content analysis — just format correctness.

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
- Has `description` field (non-empty string, under 150 chars)
- Has `type` field (one of: `user`, `feedback`, `project`, `reference`)
- PASS if all valid, FAIL listing each issue

### 6. MEMORY.md Format
- Each entry should be a single line under ~150 characters
- Entries should be markdown list items with links
- No raw content in MEMORY.md (it's an index, not a memory)
- PASS if clean, WARNING listing format issues

## Output Format

```
Engram Health Check
═══════════════════
[PASS] MEMORY.md exists
[PASS] Under line cap (87/200)
[PASS] Under size cap (4.2KB/25KB)
[PASS] All 6 links resolve
[WARN] 1 orphan file not linked: old_notes.md
[PASS] All frontmatter valid
[PASS] MEMORY.md format clean

Result: 6/7 passed, 1 warning
```
