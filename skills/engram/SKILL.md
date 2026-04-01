---
name: engram
description: Audit Claude Code auto-memory — checks caps, detects bloat, finds stale references, scores health, cross-project scanning, persistent history. Run with /engram or /engram audit.
---

# Engram — Memory Audit

You are a memory optimization expert for Claude Code. You understand the internal memory system:

- **MEMORY.md** is the index file, capped at **200 lines** and **25KB**. Content past these limits is silently truncated and invisible to Claude.
- **Relevance filtering** uses a Sonnet side-query to pick the **top 5** most relevant memories per conversation, based on the `description` field in each memory file's frontmatter.
- **Memory types** are: `user`, `feedback`, `project`, `reference` — the `type` field in frontmatter is parsed and used for filtering.
- **Frontmatter format** requires `name`, `description`, and `type` fields in YAML front matter.
- Memory files live in the auto-memory directory alongside MEMORY.md.

## What To Do

Run a comprehensive audit of the user's memory system and produce a structured report.

### Step 1: Locate Memory

Find the MEMORY.md file. Check these locations in order:
1. The auto-memory directory for the current project (usually `.claude/projects/<project-key>/memory/MEMORY.md`)
2. Search with Glob for `**/MEMORY.md` within `.claude/`

If no MEMORY.md exists, tell the user they have no auto-memory configured and stop.

### Step 2: Read Everything

1. Read MEMORY.md completely. Count lines and estimate byte size (count characters as reasonable byte estimate).
2. Extract all file links from MEMORY.md (markdown link format: `[Title](filename.md)`).
3. Read every linked memory file. For each, extract:
   - Frontmatter fields (name, description, type)
   - Line count
   - Content summary (2-3 sentence gist)

### Step 3: Check Caps

Calculate and report:
- MEMORY.md line count vs 200-line cap (show percentage)
- MEMORY.md byte size vs 25KB cap (show percentage)
- If over 150 lines or 20KB, flag as WARNING (approaching limit)
- If over 200 lines or 25KB, flag as CRITICAL (content is being truncated)

### Step 4: Detect Derivable Content

For each memory file, look for content that likely exists in the codebase:
- **File paths** — Use Glob to check if referenced paths exist. If they do, the path is derivable.
- **CLI commands** — Use Grep to check if commands appear in scripts, Makefiles, package.json.
- **Config values** — Use Grep to check if they appear in config files (*.yaml, *.json, *.toml, *.env).
- **Function/class names** — Use Grep to verify they exist in source files.

Flag each derivable item with WHERE it exists in code.

### Step 5: Detect Stale References

For each memory file, check if referenced entities still exist:
- **File paths** — do they still exist? (Glob)
- **Function names** — do they still exist in the codebase? (Grep)

### Step 6: Detect Duplicates (MCP-Enhanced)

Call the MCP tool `engram_analyze_duplicates` with the memory directory path. This performs Jaccard similarity analysis on tokenized content — more rigorous than subjective comparison.

Review the returned similarity scores and present pairs above 0.25 threshold with merge recommendations.

### Step 7: Cross-Project Scan (MCP-Enhanced)

Call the MCP tool `engram_scan_all_projects` to get a unified view across ALL projects. Report:
- Total projects with memory
- Cross-project duplicates (same content in different projects)
- Projects approaching or over caps

### Step 8: Check Orphans and Dead Links

- **Orphan files**: Glob for `*.md` in memory directory (excluding MEMORY.md). Check against MEMORY.md links.
- **Dead links**: Check each link in MEMORY.md resolves to a real file.

### Step 9: Score Relevance Density

For each memory file, estimate relevance density:
- **High density**: Every line contains non-obvious, actionable information
- **Medium density**: Mix of useful content and filler
- **Low density**: Mostly derivable, obvious, or verbose content

Also check description quality — descriptions under 30 characters are too vague for relevance matching.

### Step 10: Check File Changes (MCP-Enhanced)

Call `engram_watch_status` with the memory directory to detect recent changes since the last audit.

### Step 11: Produce Report

Output the report in this format:

```
Engram Audit Report v2
═══════════════════════
MEMORY.md:  [lines]/200 lines ([pct]%) | [size]/25KB ([pct]%)
Files:      [count] memory files linked, [orphans] orphans, [dead] dead links
Projects:   [n] total with memory ([cross-dupes] cross-project duplicates)

Health:     [████████████░░░░░░░░] [GOOD/WARNING/CRITICAL] ([score]/100)

Type Distribution:
  user: [n]  |  feedback: [n]  |  project: [n]  |  reference: [n]

Recent Changes:
  [list any file additions/modifications/deletions since last check]

Issues Found:
  [CRITICAL/WARNING/INFO]  [description]
  ...

Cross-Project Duplicates:
  [file1] (project1) <-> [file2] (project2)  [similarity]%
  ...

Top Recommendations:
  1. [Most impactful action]
  2. [Second most impactful]
  3. [Third most impactful]
```

### Step 12: Save to History (MCP-Enhanced)

Call `engram_save_audit` with the project name, health score, issue count, line usage, size usage, and file count. This enables trend tracking across audits.

**Health Score Calculation:**
- Start at 100
- -30 if over 200-line cap (truncation happening)
- -15 if over 150 lines (approaching cap)
- -5 per derivable item (max -25)
- -10 per stale reference (max -20)
- -5 per orphan file
- -5 per dead link
- -3 per missing frontmatter field
- -5 per low-density memory file
- -3 per vague description (under 30 chars)
- -5 per cross-project duplicate

Clamp to 0-100 range.

After the report, mention that the user can run:
- `/engram-optimize` to fix issues interactively
- `/engram-suggest` to find what's missing
- `/engram-claudemd` to audit CLAUDE.md files
- `/engram-profiles` to manage memory configurations
