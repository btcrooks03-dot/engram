---
name: engram-health
description: Quick structural validation — frontmatter, links, types, descriptions, effectiveness, cross-project, cap warnings. Run with /engram-health.
---

# Engram — Memory Health Check

Quick validation with effectiveness awareness. Lightweight but thorough.

## Checks

### 1. MEMORY.md Exists
- Find MEMORY.md (`.claude/projects/*/memory/` or Glob search)
- PASS/FAIL

### 2. Under Caps
- Lines vs 200, bytes vs 25,600
- PASS / WARNING (>75%) / FAIL (>100%)

### 3. All Links Resolve
- Every `[Title](file.md)` in MEMORY.md points to an existing file
- PASS / FAIL (list dead links)

### 4. All Files Linked
- Every `*.md` in memory dir is referenced in MEMORY.md
- PASS / WARNING (list orphans)

### 5. Valid Frontmatter
- YAML frontmatter with `name`, `description` (non-empty, under 150 chars, **30+ chars**), `type` (valid enum)
- PASS / FAIL (list issues)

### 6. Index Format
- Single-line entries, markdown list items with links, no raw content
- PASS / WARNING

### 7. Description Quality
Call `engram_generate_descriptions`:
- Descriptions under 30 chars: WARNING
- Generic descriptions: WARNING
- Show suggested replacements inline
- PASS if all specific and searchable

### 8. Type Coverage
- Missing `feedback`: WARNING (most valuable type)
- Missing `user`: INFO
- Missing `reference`: INFO
- PASS if all 4 present

### 9. Effectiveness Check
Call `engram_effectiveness`:
- Any file scoring < 40: WARNING with reason
- Average < 60: WARNING
- PASS if all files >= 40 and average >= 60

### 10. Cross-Project Status
Call `engram_scan_all_projects`:
- Any project over 75% cap: WARNING
- Cross-project duplicates: INFO
- PASS if all healthy

### 11. Recent Changes
Call `engram_watch_status`:
- Show any changes since last check
- Flag cap warnings

## Output

```
Engram Health Check
════════════════════
[PASS] MEMORY.md exists
[PASS] Under line cap (87/200)
[PASS] Under size cap (4.2KB/25KB)
[PASS] All 6 links resolve
[PASS] No orphan files
[PASS] All frontmatter valid
[PASS] Index format clean
[WARN] 2 descriptions need improvement (suggestions available)
[PASS] All 4 memory types present
[WARN] 1 file scoring below 40 — project_old.md (32/100)
[PASS] All 3 projects healthy
[INFO] 2 files modified since last check

Result: [passed]/[total] passed, [warnings] warnings

Quick actions:
  /engram           — Fast audit with scoring
  /engram-deep      — Thorough audit with derivable content scan
  /engram-optimize  — Fix issues interactively
  /engram-suggest   — Find what's missing
  /engram-init      — Bootstrap new project memory
  /engram-claudemd  — Audit CLAUDE.md files
  /engram-profiles  — Manage memory configurations
  /engram-log       — View changelog
```
