# Engram v3

Elite memory optimization for [Claude Code](https://claude.ai/code). MCP server + 10 skills + proactive hooks for auditing, optimizing, generating, and managing your auto-memory and CLAUDE.md files.

## What Changed in v3

- **Deterministic derivable content detection** — MCP tool scans memory for file paths, CLI commands, function names, and config values, then checks the codebase. No more LLM guesswork.
- **Relevance simulation with confidence scoring** — bigram + phrase matching predicts which memories get selected, with high/medium/low confidence indicators per file
- **Phrase-aware description generator** — extracts bigrams/trigrams, uses type-aware templates to generate purpose-oriented descriptions (not keyword soup)
- **Conversation pattern learning** — logs session topics over time, analyzes which recurring topics aren't covered by memory. The highest-signal suggestion source: you literally needed this context repeatedly.
- **Smart merge generator** — produces deduplicated merged files server-side, ready to apply
- **Per-file effectiveness scoring** — 0-100 score based on description quality, freshness, uniqueness, density, and type
- **Fast/deep audit split** — `/engram` is now MCP-only (5 seconds, deterministic), `/engram-deep` adds full codebase scanning
- **Bootstrap/onboarding** — `/engram-init` scans your project and proposes starter memories with guided prompts
- **Memory changelog** — persistent log of all memory operations across conversations
- **Proactive hooks** — shell scripts for post-write validation and conversation-start health checks

## Why It Matters

Claude Code's memory system has hidden constraints:

- **200-line cap** on MEMORY.md (silently truncated past this)
- **25KB size cap** (same)
- **Top 5 relevance** — only 5 memories selected per conversation via the `description` field (40-100 chars, specific and searchable)
- **Type-based filtering** — `type` frontmatter is parsed, not decorative

Engram makes this system observable, optimizable, and proactive.

## Install

```bash
claude plugin add github:btcrooks03-dot/engram
```

Restart Claude Code after install so the MCP server registers.

### Optional: Enable Hooks

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "command": "~/.claude/plugins/marketplaces/engram/hooks/post-memory-write.sh \"$TOOL_INPUT_FILE_PATH\""
      }
    ]
  }
}
```

This warns you in real-time when a memory write approaches caps, has weak descriptions, or creates orphan files.

## Commands

### `/engram` — Fast Audit

MCP-powered, deterministic, ~5 seconds. Caps, duplicates, effectiveness scores, description quality, cross-project scan.

```
Engram Audit (Fast)
════════════════════
MEMORY.md:  87/200 lines (43%) | 4.2KB/25KB (17%)
Files:      6 linked, 0 orphans, 0 dead links
Projects:   3 with memory (1 cross-project duplicate)

Health:     ██████████████░░░░░░ GOOD (78/100)

Effectiveness (per file):
  user_role.md          92/100
  feedback_testing.md   85/100
  project_events.md     61/100
  reference_tools.md    45/100  — weak description
  Average: 71/100
```

### `/engram-deep` — Deep Audit

Full codebase scan: derivable content detection, stale references, relevance simulation. Takes longer.

```
Derivable Content Found: 4 items
  [FILEPATH]    project_notes.md  →  exists at ./src/config.py
  [CLI_CMD]     project_notes.md  →  found in package.json scripts
  [FUNC_NAME]   project_notes.md  →  defined in ./src/agent.py

Relevance Simulation (for "debug auth flow"):
  Confidence: medium — some good matches, some uncertain
  1. feedback_testing.md  (0.42, high)  — phrases: "auth flow", "debug"
  2. user_role.md         (0.31, medium) — phrases: "developer"
  3. project_events.md    (0.18, low)    — terms: project
  NOT selected: reference_tools.md (0.03, low)

Session Coverage (12 sessions logged):
  Topics covered: 8 of 11 recurring
  Gaps:
    "database migration" — 4 sessions, no memory covers it
    "rate limiting" — 3 sessions, best match: project_notes.md at 8%
```

### `/engram-optimize` — Interactive Optimizer

Now with deterministic detection, smart merge generation, and auto-generated descriptions.

```
Issue 2/5: DUPLICATE CONTENT (similarity: 0.72)
Files: project_notes.md <-> project_context.md

Proposed Fix (auto-generated merge):
  Merged file: 18 lines (was 32 total) — 14 lines saved
  [shows merged content]

Apply this fix? (yes/skip/edit)
```

### `/engram-suggest` — Generative Suggestions

Analyzes gaps with effectiveness awareness.

### `/engram-init` — Bootstrap (NEW)

Scans your project, proposes starter memories with guided prompts. For new projects or fresh starts.

```
Memory 1/4: USER — HIGH PRIORITY
Name: User Role

Why This Memory:
  Every project benefits from Claude knowing who it's working with.

Content Prompts:
  - What is your role?
  - Experience level with Python/Node?
  - Communication preferences?

Create this memory? (yes/skip/edit)
```

### `/engram-claudemd` — CLAUDE.md Audit

Audits all CLAUDE.md files across scopes.

### `/engram-profiles` — Memory Profiles

Save, load, diff, delete named memory configurations.

### `/engram-health` — Quick Validation

11 checks including effectiveness and description quality.

### `/engram-stats` — Dashboard

Stats with effectiveness scores, audit trend, and changelog.

### `/engram-log` — Changelog (NEW)

View history of all memory operations across conversations.

```
Engram Memory Changelog
════════════════════════
  2024-03-22  optimize     project_notes.md     Removed 3 derivable lines
  2024-03-22  merge        notes.md, ctx.md     14 lines saved
  2024-03-20  profile      (all files)          Loaded "debugging" profile
```

## MCP Server Tools

22 tools providing real computation, persistence, pattern learning, and cross-project awareness:

| Tool | Purpose |
|------|---------|
| **Scanning** | |
| `engram_scan_all_projects` | Cross-project memory scan with duplicate detection |
| `engram_detect_derivable` | Deterministic derivable content detection via filesystem/grep |
| `engram_scan_claudemd` | Multi-scope CLAUDE.md audit |
| **Analysis** | |
| `engram_analyze_duplicates` | Jaccard similarity scoring between memory files |
| `engram_effectiveness` | Per-file effectiveness scoring (0-100) |
| `engram_simulate_relevance` | Predict which memories would be selected for a task |
| **Generation** | |
| `engram_generate_descriptions` | TF-IDF-based description optimization |
| `engram_generate_merge` | Deduplicated merge of two memory files |
| `engram_suggest_memories` | Gap analysis and memory suggestions |
| `engram_bootstrap` | Project scan for starter memory suggestions |
| **Profiles** | |
| `engram_profile_save` | Snapshot current memory state |
| `engram_profile_load` | Restore a saved profile |
| `engram_profile_list` | List available profiles |
| `engram_profile_delete` | Delete a profile |
| `engram_profile_diff` | Compare current state with a profile |
| **History** | |
| `engram_save_audit` | Persist audit results |
| `engram_get_history` | Retrieve audit trend data |
| `engram_watch_status` | File change detection |
| `engram_log_operation` | Record a memory operation |
| `engram_get_changelog` | Retrieve operation history |
| `engram_memory_git_log` | Git-based memory drift tracking |
| **Learning** | |
| `engram_log_session` | Log conversation topics for pattern learning |
| `engram_session_coverage` | Analyze which recurring topics lack memory coverage |

## Hooks

Engram includes optional shell hooks for proactive monitoring:

| Hook | Trigger | What It Does |
|------|---------|-------------|
| `post-memory-write.sh` | After any Write to memory dir | Validates caps, frontmatter, description quality, orphan status |
| `conversation-start.sh` | First Read in conversation | Scans all projects for cap warnings, dead links, orphans |

Hooks output warnings to stderr only when issues are found. Silent when everything is healthy.

## Architecture

```
engram/
  .mcp.json                    — MCP server registration
  src/server.ts                — TypeScript MCP server (20 tools)
  dist/server.js               — Compiled server
  hooks/
    post-memory-write.sh       — Post-write validation hook
    conversation-start.sh      — Conversation-start health hook
  skills/
    engram/                    — Fast audit (MCP-only)
    engram-deep/               — Deep audit (+ codebase scan)
    engram-optimize/           — Interactive optimizer
    engram-health/             — Quick validation (11 checks)
    engram-stats/              — Dashboard
    engram-suggest/            — Generative suggestions
    engram-claudemd/           — CLAUDE.md audit
    engram-profiles/           — Memory profiles
    engram-init/               — Bootstrap/onboarding
    engram-log/                — Changelog viewer
```

## What It Detects

| Issue | Detection Method | Why It Matters |
|-------|-----------------|---------------|
| Derivable content | MCP filesystem scan | Wastes memory space with info already in code |
| Stale references | Glob + Grep verification | Misleads Claude with dead references |
| Duplicates | Jaccard similarity | Wastes space, confuses relevance scoring |
| Cross-project duplicates | Multi-project scan | Inconsistent context across projects |
| Weak descriptions | TF-IDF analysis | Wrong memories get selected (primary signal) |
| Low effectiveness | 5-dimension scoring | Dead weight memories taking up cap space |
| Missing types | Coverage analysis | Missing feedback = Claude repeats mistakes |
| CLAUDE.md bloat | Pattern matching | Generic instructions dilute important rules |
| Memory/CLAUDE.md overlap | Cross-reference similarity | Redundancy across both systems |
| Orphans + dead links | Index verification | Invisible files / wasted index lines |

## Phantom Integration

If [Phantom](https://github.com/btcrooks03-dot/phantom) (workflow orchestrator plugin) is installed alongside Engram, the two plugins create a feedback loop: Phantom workflows produce structured session data, Engram turns that into actionable memory insights.

### What Phantom sends to Engram

Three Phantom skills call `engram_log_session` after completion with structured topics:

- **`/phantom-debug`** → bug categories, root cause patterns, affected components
- **`/phantom-build`** → feature areas, technology patterns, architectural decisions
- **`/phantom-receive-review`** → review feedback themes, recurring corrections

This is the highest-quality signal for `engram_session_coverage` — structured workflow outcomes are far better than heuristically inferred conversation topics.

### What Engram sends to Phantom

`/phantom-plan` calls `engram_simulate_relevance` during context gathering to check what memories exist for the task. Feedback memories (past corrections) are treated as critical planning overrides.

### Why this matters

Without integration, both plugins are stateless between conversations — Phantom doesn't know what you've learned, Engram doesn't know what workflows you run. Connected, Engram's gap detection actually has data to work with, and Phantom's planner avoids repeating mistakes you've already corrected.

### Without Phantom

Engram works fully without Phantom installed. The only feature that degrades is `engram_session_coverage` (used by `/engram-deep` and `/engram-suggest`), which returns limited or empty data without structured session logs. When this happens, skills gracefully skip the session coverage section and rely on heuristic gap detection instead. No errors, no broken workflows.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol
- `zod` — Schema validation
- `typescript` — Build toolchain

## License

MIT
