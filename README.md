# Engram v4

Memory optimization for [Claude Code](https://claude.ai/code). MCP server + 11 skills + 27 MCP tools + proactive hooks. Audit, optimize, and manage memory across individuals, teams, and orgs.

## What It Does (Plain English)

Every time you open Claude Code, it starts mostly fresh. It might pick up a few saved memories, but most users never set those up properly. So Claude asks the same questions, makes the same mistakes, and doesn't know anything about you, your team, or your company.

**Engram fixes this.** It gives you:

- **Templates** so you don't start from zero. Pick your role (developer, manager, data scientist) or your industry (reinsurance, consulting) and answer a few guided questions. Done.
- **Shared memory** so your whole team benefits. Teach Claude something once (your company's terminology, compliance rules, tool locations) and everyone gets it.
- **Audits** that tell you when your memory is broken, stale, or missing important things.
- **Health dashboards** so team leads can see who's getting value from Claude and who's struggling.

The goal: **turn Claude from a smart stranger into a colleague who actually knows your organization.**

## Who Is This For

| User | What They Get |
|------|--------------|
| **Individual developer** | Claude remembers your stack, preferences, and past corrections across every conversation |
| **Non-technical user** | Run `/engram-setup`, answer questions in plain English, never touch a config file |
| **Team member** | Shared memory means you inherit company knowledge on day one |
| **Team lead / admin** | Visibility into who has healthy memory, common gaps, and shared knowledge coverage |
| **Company rolling out Claude Code** | Templates + shared memory = consistent quality across all users without training each person |

### Example: Reinsurance Company

An underwriter runs `/engram-setup`, picks the **Reinsurance** template, answers prompts about their role, compliance frameworks, and treaty programs. Now every conversation with Claude knows:

- They write E&S property quotes, not general insurance
- Incline's preferred treaty language and where it lives
- To use AM Best ratings, not S&P (a correction saved as feedback memory)
- That "the portal" means a specific submission system, not a generic term

Meanwhile, the ops team puts shared knowledge in a team directory: company glossary, compliance rules, standard workflows. Every user's Claude loads those shared memories automatically. Update once, everyone benefits.

## Why It Matters (Technical)

Claude Code's memory system has hidden constraints:

- **200-line cap** on MEMORY.md (silently truncated past this)
- **25KB size cap** (same)
- **Top 5 relevance** — only 5 memories selected per conversation via the `description` field (40-100 chars, specific and searchable)
- **Type-based filtering** — `type` frontmatter is parsed, not decorative

Most users don't know any of this. Their memory silently degrades and Claude gets less helpful over time without anyone noticing. Engram makes this system observable, optimizable, and proactive.

## Install

```bash
claude plugin add github:btcrooks03-dot/engram
```

Restart Claude Code after install so the MCP server registers.

Then run `/engram-setup` to configure everything interactively.

## Getting Started

Run `/engram-setup`. It walks you through everything:

1. Detects what's already configured
2. Lets you pick a memory template for your role or workflow
3. Guides you through filling in each memory file
4. Optionally connects you to a team's shared memory
5. Enables real-time hooks for write validation

Every step is skippable. Takes 2-5 minutes for a full setup, under 30 seconds if you just want the defaults.

Already have memory set up? Run `/engram` for a quick audit instead.

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

### `/engram-setup` — First-Time Setup

Interactive onboarding for new users. Choose a template, configure team access, enable hooks. Works for beginners and power users.

```
Engram Setup
════════════
Welcome! This will walk you through setting up memory optimization
for Claude Code. Each step is optional — skip anything you don't need.

Environment Check:
  Memory:     No memory files yet
  Hooks:      Not configured
  Team:       Not configured

Step 2 of 6: Choose a template
  developer        Developer starter set
  manager          Manager starter set
  ...

Pick a template by name, or type 'skip' to move on.
```

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

## Team & Org Features

When multiple people in your organization use Claude Code, engram makes sure they aren't all teaching Claude the same things independently.

### Templates (7 built-in)

Pick a template during `/engram-setup` and answer guided prompts. No markdown or config files to understand.

| Template | For | What It Sets Up |
|----------|-----|----------------|
| `solo-developer` | Individual devs | Role, coding preferences, project context |
| `team-member` | Someone on a team | Role + team context, shared conventions, team resources |
| `engineering-manager` | Managers | Role + reports, review preferences, team priorities, dashboards |
| `data-scientist` | Data/ML folks | Role + domain, experiment preferences, dataset references |
| `reinsurance` | Insurance/reinsurance orgs | Role, compliance rules, treaty/program context, industry tools |
| `consulting` | Consulting firms | Role + clients, communication preferences, active engagements, client portals |
| `custom` | Anyone | Minimal starter — just user + feedback memories |

Create your own templates in `~/.claude/plugins/data/engram/custom-templates/`.

### Shared Memory

The problem: if 15 people use Claude Code, each one independently teaches Claude about your company's tools, terminology, and rules. That's 15x the wasted effort, with inconsistent results.

The fix: point everyone at a shared directory (a git repo works well):

1. Someone creates shared memory files — company glossary, compliance rules, tool references
2. Each user runs `/engram-setup` and connects to the shared directory
3. Every user's Claude automatically loads shared memories alongside their personal ones
4. Update the shared directory once, everyone benefits

Shared memory supports **read-only** (most users) and **read-write** (admins who maintain it) modes.

### Team Health Dashboard

When team config is active, `/engram-stats` shows:

- **Shared memory quality** — effectiveness scores for each shared file
- **Contributor activity** — who's maintaining shared memory, when they last contributed
- **Coverage gaps** — recurring topics across the team that no shared memory covers

This gives team leads visibility into whether Claude Code adoption is actually working across the org.

## MCP Server Tools

27 tools providing real computation, persistence, pattern learning, and cross-project awareness:

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
| **Templates** | |
| `engram_list_templates` | List available memory templates by category |
| `engram_apply_template` | Apply a template — returns file structures for user confirmation |
| **Team** | |
| `engram_team_config` | Get or set team configuration for shared memory |
| `engram_scan_shared` | Scan shared memory directory with effectiveness scores |
| `engram_team_health` | Analyze team memory health, contributor activity, and gaps |
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
  src/
    server.ts                  — MCP tool registrations (slim orchestrator)
    constants.ts               — Shared constants and config
    types.ts                   — All TypeScript interfaces
    helpers.ts                 — File I/O, frontmatter parsing
    scanning.ts                — Memory directory scanning
    analysis.ts                — Similarity, effectiveness, relevance scoring
    generation.ts              — Description generation, merge, suggestions, bootstrap
    profiles.ts                — Named memory profile CRUD
    history.ts                 — Audit history, changelog, change tracking
    learning.ts                — Session logging, coverage analysis
    git.ts                     — Git log/diff for memory directories
    templates.ts               — Org template system (7 built-in + custom)
    shared.ts                  — Shared/team memory layer
    __tests__/                 — 112 vitest tests across 8 files
  templates/                   — Built-in template JSON files
  hooks/
    post-memory-write.sh       — Post-write validation hook
    conversation-start.sh      — Conversation-start health hook
  scripts/
    postinstall.js             — Auto-configures hooks on install
  skills/
    engram-setup/              — First-time setup (start here)
    engram/                    — Fast audit
    engram-deep/               — Deep audit (+ codebase scan)
    engram-optimize/           — Interactive optimizer
    engram-health/             — Quick validation
    engram-stats/              — Dashboard + team health
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
