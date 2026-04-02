---
name: engram-profiles
description: Memory profiles — save, load, and switch between named memory configurations for different workflows (debugging, feature work, refactoring).
---

# Engram — Memory Profiles

You manage memory profiles — named snapshots of the entire memory state that can be swapped for different workflows.

## Why Profiles

Different tasks need different context:
- **Debugging** needs: error patterns, system architecture, recent incidents, monitoring refs
- **Feature work** needs: user preferences, project goals, coding conventions, API refs
- **Refactoring** needs: architecture decisions, dependency maps, test coverage info
- **Onboarding** needs: team structure, repo layout, key contacts, getting-started refs

With only 5 memories selected per conversation, having the RIGHT 5 for your current task matters more than having 20 generic ones.

## Process

### Step 0: Locate Memory

Find the MEMORY.md file. Check these locations in order:
1. The auto-memory directory for the current project (usually `.claude/projects/<project-key>/memory/MEMORY.md`)
2. Search with Glob for `**/MEMORY.md` within `.claude/`

The memory directory path is needed for all MCP tool calls below.

### Step 1: Determine Action

Parse the user's request to determine which action:
- **list** — Show all saved profiles
- **save [name]** — Snapshot current memory as a named profile
- **load [name]** — Restore a saved profile (backs up current state first)
- **diff [name]** — Compare current memory with a saved profile
- **delete [name]** — Remove a saved profile

If the user just runs `/engram-profiles` with no arguments, show the list and explain available actions.

### Step 2: Execute

**For LIST:**
1. Call MCP tool `engram_profile_list` with the memory directory
2. Display profiles with name, creation date, and file count
3. Detect active profile: call `engram_profile_diff` for each profile — if a profile has zero differences (all files match), it's the active one. If no profile matches exactly, show "no exact match (current state has been modified since last profile load)"

**For SAVE:**
1. Confirm the profile name with the user
2. Call MCP tool `engram_profile_save`
3. Confirm save and show file count

**For LOAD:**
1. Call `engram_profile_list` to verify the profile exists
2. WARN the user: "This will replace your current memory files. Current state will be auto-backed up as '_previous_auto_backup'. Proceed?"
3. Wait for confirmation
4. Call MCP tool `engram_profile_load`
5. Show what changed (files added, removed, modified)

**For DIFF:**
1. Call MCP tool `engram_profile_diff` with the memory directory and profile name
2. Display the comparison:
   - Files only in current state
   - Files only in profile
   - Files in both (with changed/unchanged status and line counts)

**For DELETE:**
1. Confirm with user: "Delete profile '[name]'? This cannot be undone."
2. Wait for confirmation
3. Call MCP tool `engram_profile_delete` with the memory directory and profile name

### Output Format

**List:**
```
Engram Memory Profiles
══════════════════════
Project: [project-key]

  [name]           [files]  [created]
  debugging        7 files  2024-03-15
  feature-work     5 files  2024-03-20
  _previous_auto   6 files  2024-03-22 (auto-backup)

Active: [current state matches "feature-work" / no match]

Commands:
  /engram-profiles save <name>    — Save current memory as profile
  /engram-profiles load <name>    — Restore a saved profile
  /engram-profiles diff <name>    — Compare current with profile
  /engram-profiles delete <name>  — Delete a profile
```

## Rules

- **ALWAYS back up before loading.** The auto-backup ensures the user can recover.
- **NEVER load without confirmation.** Loading replaces all memory files.
- **Profile names must be descriptive.** Reject single-character or meaningless names.
- **Show the impact.** Before loading, show what will change (files added/removed/modified).
