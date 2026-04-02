---
name: engram-deep
description: Deep memory audit with deterministic derivable content detection, stale reference scanning, effectiveness scoring, and relevance simulation. Slower but thorough. Run with /engram-deep.
---

# Engram — Deep Audit

You are a memory optimization expert running the DEEP audit. This is the thorough version of `/engram` — it includes derivable content detection, stale reference scanning, per-file effectiveness scoring, and relevance simulation. It takes longer but finds everything.

For a quick MCP-only audit, use `/engram` instead.

## Internal Knowledge

- **MEMORY.md** is capped at **200 lines / 25KB** — content past these limits is silently truncated
- **Top 5 selection** via Sonnet side-query using the `description` frontmatter field
- **Memory types**: `user` (role/expertise), `feedback` (corrections/confirmations — most valuable), `project` (ongoing work/decisions), `reference` (external resource pointers)
- **Descriptions**: 40-100 chars, specific and searchable — primary relevance signal

## Process

### Step 1: Locate Memory

Find MEMORY.md:
1. Check `.claude/projects/<project-key>/memory/MEMORY.md`
2. Search with Glob for `**/MEMORY.md` within `.claude/`

If not found, tell the user and stop.

### Step 2: MCP-Powered Analysis (Deterministic)

Run these MCP tools in parallel where possible:

1. `engram_scan_all_projects` — cross-project overview and duplicates
2. `engram_analyze_duplicates` — Jaccard similarity between all memory pairs
3. `engram_detect_derivable` — **deterministic** scan for file paths, CLI commands, function names, config values that exist in the codebase
4. `engram_effectiveness` — per-file scoring (description quality, freshness, uniqueness, density)
5. `engram_generate_descriptions` — auto-generated replacements for weak descriptions
6. `engram_watch_status` — recent file changes
7. `engram_session_coverage` — analyze which recurring conversation topics are/aren't covered by memory

**Phantom Integration Note:** `engram_session_coverage` provides highest-signal results when the [Phantom](https://github.com/btcrooks03-dot/phantom) plugin is installed, as Phantom workflows log structured session topics. Without Phantom, session coverage analysis may return limited or empty data — this is expected. If session data is empty, skip the Session Coverage section of the report and note: "Session coverage unavailable — install Phantom plugin for conversation pattern tracking, or run `/engram-suggest` for heuristic gap detection."

### Step 3: Stale Reference Scan (Tool-Assisted)

For each memory file, check if referenced entities still exist:
- **File paths** mentioned in memory — use Glob to verify they exist at the stated path
- **Function/class names** — use Grep to verify they exist in source code
- **Config values or CLI commands** — use Grep to verify they appear in package.json, Makefiles, or scripts
- Note which references are stale and what they pointed to

**Handling partial staleness:**
- If a file was moved but the function still exists elsewhere → mark as MOVED, suggest updating the path
- If a function was renamed → mark as RENAMED, suggest updating the reference
- If both file and function are gone → mark as REMOVED, suggest deleting the reference from memory

**Example stale reference output:**
```
  project_notes.md: "./src/auth/middleware.py" — file MOVED to ./src/middleware/auth.py
  feedback_api.md: "validate_token()" — function RENAMED to verify_token() in ./src/auth.py
  reference_tools.md: "npm run migrate" — script REMOVED from package.json
```

### Step 4: Relevance Simulation

Ask the user: "What kind of task would you typically start a conversation about?"

If they provide a task description, call `engram_simulate_relevance` to show which memories would be selected and which would be missed. This makes description optimization concrete — the user can see the impact.

If they skip this step, proceed to the report.

### Step 5: Produce Deep Report

```
Engram Deep Audit
══════════════════
MEMORY.md:  [lines]/200 lines ([pct]%) | [size]/25KB ([pct]%)
Files:      [count] linked, [orphans] orphans, [dead] dead links
Projects:   [n] with memory ([cross-dupes] cross-project duplicates)

Health:     [████████████░░░░░░░░] [GOOD/WARNING/CRITICAL] ([score]/100)

Effectiveness Scores:
  [filename.md]     [score]/100  [issues summary]
  [filename.md]     [score]/100  [issues summary]
  ...
  Average: [avg]/100

Derivable Content Found: [n] items
  [FILEPATH]    [file.md]  →  exists at [path]
  [CLI_CMD]     [file.md]  →  found in [script]
  [FUNC_NAME]   [file.md]  →  defined in [source]
  ...

Stale References: [n]
  [file.md]: [reference] — no longer exists
  ...

Duplicate Pairs: [n]
  [file1] <-> [file2]  [sim]%  [MERGE/REVIEW/MONITOR]
  ...

Description Improvements Available: [n]
  [file.md]: "[current]" → "[suggested]"
  ...

Relevance Simulation (if run):
  For task "[description]":
    Confidence: [high/medium/low]
    1. [file] (score: [n], [confidence]) — phrases: [matched phrases]
    2. ...
    5. [file] (score: [n], [confidence])
    ---
    NOT selected: [files with low confidence]

Session Coverage (if session data exists):
  Sessions logged: [n]
  Topics covered:    [n] of [total recurring topics]
  Coverage gaps:
    "[topic]" — came up [n] times, best match: [file] at [pct]%
    ...

Top Recommendations:
  1. [highest impact action]
  2. [second highest]
  3. [third highest]
```

### Step 6: Save to History

Call `engram_save_audit` with the results. Call `engram_log_operation` to record the deep audit.

After the report, suggest:
- `/engram-optimize` to fix issues interactively
- `/engram-suggest` to find what's missing
- `/engram-init` if memory is sparse

## Health Score (Deep)

Start at 100:
- -30 if over 200-line cap
- -15 if over 150 lines
- -3 per derivable item (max -30)
- -5 per stale reference (max -20)
- -5 per orphan/dead link
- -3 per file with effectiveness score < 40
- -2 per vague description
- -5 per cross-project duplicate
- Bonus: +5 if all 4 memory types present
- Bonus: +5 if average effectiveness > 70

Clamp to 0-100.

## MCP Tool Failure Handling

If any MCP tool call fails:
- **Do not halt the audit.** Report results from tools that succeeded.
- Mark failed sections as `[UNAVAILABLE — tool error]` in the report.
- Note which tools failed and suggest retrying.
- If `engram_session_coverage` fails specifically, this likely means no session data exists yet — note this is normal for new setups.
