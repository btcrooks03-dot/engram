---
name: engram
description: Audit Claude Code auto-memory — checks caps, detects bloat, finds stale references, scores health. Run with /engram or /engram audit.
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

1. Read MEMORY.md completely. Count lines and estimate bytes (line count × average ~60 bytes per line, or count actual characters).
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
- **File paths** — Use Glob to check if referenced paths exist. If they do, the path is derivable from the codebase.
- **CLI commands** — Look for command-line invocations (lines starting with backtick-wrapped commands like `py`, `python`, `npm`, `node`, `git`, etc.). Use Grep to check if these commands appear in scripts, Makefiles, package.json, or main entry files.
- **Config values** — Look for specific numbers, IDs, or settings that look like configuration. Use Grep to check if they appear in config files (*.yaml, *.json, *.toml, *.env).
- **Function/class names** — Look for code identifiers mentioned in memory. Use Grep to verify they exist in source files.

Flag each derivable item with WHERE it exists in code so the user can verify.

### Step 5: Detect Stale References

For each memory file, check if referenced entities still exist:
- **File paths** mentioned in memory — do they still exist? (Glob)
- **Function names** mentioned — do they still exist in the codebase? (Grep)

Flag anything that references something that no longer exists.

### Step 6: Detect Duplicates and Overlaps

Compare memory files pairwise:
- Do any two files cover the same topic?
- Are there repeated facts across files?
- Could any files be merged?

### Step 7: Check Orphans and Dead Links

- **Orphan files**: Use Glob to find all `*.md` files in the memory directory (excluding MEMORY.md). Check each against MEMORY.md links. Files not linked are orphans.
- **Dead links**: Check each link in MEMORY.md resolves to a real file in the same directory.

### Step 8: Score Relevance Density

For each memory file, estimate relevance density:
- **High density**: Every line contains non-obvious, actionable information
- **Medium density**: Mix of useful content and filler (headers, blank lines, obvious info)
- **Low density**: Mostly derivable, obvious, or verbose content

### Step 9: Produce Report

Output the report in this exact format:

```
Engram Audit Report
═══════════════════
MEMORY.md:  [lines]/200 lines ([pct]%) | [size]/25KB ([pct]%)
Files:      [count] memory files linked, [orphans] orphans, [dead] dead links

Health:     [████████████░░░░░░░░] [GOOD/WARNING/CRITICAL] ([score]/100)

Type Distribution:
  user: [n]  |  feedback: [n]  |  project: [n]  |  reference: [n]

Issues Found:
  [CRITICAL/WARNING/INFO]  [description]
  ...

Top Recommendations:
  1. [Most impactful action]
  2. [Second most impactful]
  3. [Third most impactful]
```

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

Clamp to 0-100 range.
