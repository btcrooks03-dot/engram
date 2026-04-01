---
name: engram-init
description: Bootstrap memory for a new project — scans codebase, detects language/framework, suggests starter memories. Run with /engram-init.
---

# Engram — Memory Bootstrap

You help users set up memory for a new project from scratch. Instead of starting with an empty system and hoping memories accumulate organically, you scan the project and propose a well-structured starter set.

## When To Use

- New project with no memory files yet
- Existing project where memory was never properly set up
- After clearing memory and wanting a fresh start

## Process

### Step 1: Locate Memory Directory

Find the memory directory:
1. Check `.claude/projects/<project-key>/memory/`
2. Search with Glob for `**/MEMORY.md` within `.claude/`

If MEMORY.md already exists with linked files, warn the user: "This project already has [n] memory files. /engram-init is for bootstrapping new projects. Use /engram-suggest to add to existing memory, or /engram-profiles to save current state before reinitializing."

### Step 2: Scan Project

Call `engram_bootstrap` with the project directory. This scans:
- Language and framework detection
- Package managers and dependencies
- Git remote and recent contributors
- Directory structure
- Existing CLAUDE.md files

### Step 3: Present Suggestions

For each suggestion from the bootstrap scan, present interactively:

```
Memory [n]/[total]: [TYPE] — [PRIORITY]
Name: [suggested name]
───────────────────────────

Why This Memory:
  [reasoning]

Suggested Structure:
  ---
  name: [name]
  description: [description]
  type: [type]
  ---

  [guided prompts for content — NOT pre-filled content]

Content Prompts:
  - [question 1 to help user fill in content]
  - [question 2]
  - [question 3]

Create this memory? (yes/skip/edit)
```

**Important:** Do NOT pre-fill memory content with guesses. The bootstrap scan provides structure and prompts, but the actual content should come from the user. Ask them to answer the content prompts, then write the memory with their answers.

For "edit" responses, let the user modify the name, description, or structure before creating.

### Step 4: Create Approved Memories

For each approved suggestion:
1. Ask the user to provide content based on the prompts
2. Write the memory file with their content using the Write tool
3. Add a link to MEMORY.md (create MEMORY.md if it doesn't exist)
4. Call `engram_log_operation` to record the creation

### Step 5: Summary

```
Engram Bootstrap Complete
══════════════════════════
Memories created:    [n]
Memories skipped:    [n]
MEMORY.md:           [lines]/200 lines ([pct]%)

Created:
  [filename.md]    [type]    [description]
  ...

Next steps:
  /engram-health    — Verify everything is healthy
  /engram-suggest   — Get additional suggestions as you work
  /engram           — Run a full audit
```

## Rules

- **NEVER guess memory content.** Provide structure and prompts, not fabricated answers.
- **Descriptions must be specific.** Every description should be 40-100 chars, specific and searchable.
- **Start lean.** 3-4 excellent memories beat 8 mediocre ones. Only create what the user actively engages with.
- **Respect the cap.** Each memory takes index space. Bootstrap should use at most 30% of the 200-line cap.
