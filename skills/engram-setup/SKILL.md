---
name: engram-setup
description: First-time setup -- choose a template, configure team access, enable hooks. Works for beginners and power users.
---

# Engram -- First-Time Setup

You walk users through setting up Engram from scratch. This is the one command new users run to get started. It works for complete beginners, power users, and team members joining an org that already uses Engram.

## Principles

- **Plain language.** Say "memory" not "auto-memory system." Say "templates" not "template packs."
- **Every step is skippable.** Never force a decision.
- **Show progress.** Label each step clearly: "Step 2 of 6: Choose a template."
- **Friendly, not patronizing.** Assume the user is smart but may be new to Claude Code memory.
- **Never guess content.** Templates provide structure and prompts. The user fills in the answers.

## Process

### Step 1 of 6: Welcome and Detect Environment

Show a welcome message:

```
Engram Setup
════════════
Welcome! This will walk you through setting up memory optimization
for Claude Code. Each step is optional — skip anything you don't need.
```

Then detect what's already configured:

1. **Memory**: Check if `.claude/projects/<project-key>/memory/MEMORY.md` exists. If it does, read it and count linked files.
2. **Hooks**: Read `~/.claude/settings.json` and check if `hooks.PostToolUse` contains the engram post-memory-write hook.
3. **Team config**: Call `engram_team_config` with no arguments to check if team config exists.

Report what was found:

```
Environment Check:
  Memory:     [n] files found (or "No memory files yet")
  Hooks:      [Configured / Not configured]
  Team:       [team_name configured / Not configured]
```

If everything is already set up, say so: "Looks like you're already configured! You can still re-run any step, or use /engram to run your first audit." Let them continue or exit.

If some things are set up, tailor the flow — suggest skipping steps that are already done, but don't skip them automatically.

### Step 2 of 6: Choose a Template

Ask: "Step 2 of 6: Choose a template. Templates give you a pre-built set of memory files for your role or workflow. You can skip this and set up memory manually later."

Call `engram_list_templates` to get available templates.

Present templates grouped by category. For each template, show its ID, name, and description. Example:

```
Templates
─────────
Role:
  developer        Developer starter set — coding preferences, debugging patterns, project context
  manager          Manager starter set — team members, meeting notes, decision log
  ...

Domain:
  frontend         Frontend development — components, design system, browser testing
  ...

Workflow:
  code-review      Code review habits — review checklist, common feedback patterns
  ...
```

Ask: "Pick a template by name, or type 'skip' to move on."

If the user picks a template, proceed to Step 3. If they skip, jump to Step 4.

### Step 3 of 6: Apply Template

Call `engram_apply_template` with the chosen template ID and the memory directory path.

The tool returns a list of memory files to create. For each file, it includes:
- `filename` — the file to create
- `frontmatter` — name, description, type
- `content_prompts` — questions to ask the user
- `example_content` — a reference for structure (do NOT use this as actual content)

Walk through each file interactively:

```
Memory [n]/[total]: [name]
Type: [type]
Description: [description]
─────────────────────────

To fill this in, answer these questions:
  1. [content_prompt_1]
  2. [content_prompt_2]
  3. [content_prompt_3]

Create this memory? (answer the questions above, or type 'skip')
```

**Important:** Do NOT pre-fill content with guesses or example content. The content prompts are questions for the user. Wait for their answers, then write the file using the Write tool with their responses formatted into the template structure.

For each created file:
1. Write the memory file with proper frontmatter and the user's content
2. Add a link to MEMORY.md (create MEMORY.md if it doesn't exist)
3. Call `engram_log_operation` to record the creation

After all files are processed, show a brief summary:

```
Template applied: [n] files created, [n] skipped
```

### Step 4 of 6: Team Setup (Optional)

Ask: "Step 4 of 6: Team setup. Are you part of a team using Claude Code? If your team shares memory files (like coding standards, project context, or onboarding docs), you can connect to a shared directory. Type 'skip' if you're working solo."

If the user wants team setup:

1. Ask: "What's your team name?" (used for labeling, not technical)
2. Ask: "Where are the shared memory files? Give me the directory path." (e.g., `/path/to/team-shared/memory/`)
3. Ask: "Sync mode — how should shared memories work?"
   - `read` — You can see shared memories but only edit your own (recommended for most team members)
   - `write` — You can edit shared memories too (for team leads or maintainers)

Call `engram_team_config` with:
- `team_name`: their answer
- `shared_memory_dir`: their path
- `sync_mode`: their choice

Then call `engram_scan_shared` to verify the directory works. If it returns files, show them:

```
Team configured: [team_name]
Shared memory: [n] files found at [path]
  [filename.md]    [type]    [description]
  ...
```

If the scan fails (bad path, empty directory), tell the user and let them correct the path or skip.

### Step 5 of 6: Hook Configuration

Ask: "Step 5 of 6: Enable hooks. Hooks give you real-time warnings when a memory write causes issues — like hitting the size cap, creating orphan files, or having weak descriptions. They run automatically in the background. Type 'skip' to set this up later."

If hooks are already configured (detected in Step 1), say: "Hooks are already configured. Moving on."

If the user wants hooks:

1. Read `~/.claude/settings.json`
2. If the file doesn't exist, create it with the hook config
3. If the file exists, use the Edit tool to add the hook config to the `hooks.PostToolUse` array

The hook config to add:

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

If `hooks` or `PostToolUse` already exists with other entries, append the engram entry to the existing array. Do not overwrite other hooks.

After adding, confirm: "Hooks enabled. You'll see warnings if a memory write causes issues."

### Step 6 of 6: Summary

Show a summary of everything that was set up:

```
Setup Complete
══════════════
  Memory:     [n] files ([n] from template, [n] existing)
  Template:   [template name or "none"]
  Team:       [team_name at path or "not configured"]
  Hooks:      [Enabled / Not enabled]

What's next:
  /engram         Run your first audit to check memory health
  /engram-suggest Get suggestions for new memories based on your work
  /engram-stats   See your memory dashboard
```

## Rules

- **NEVER guess memory content.** Templates provide prompts, not answers. Wait for the user.
- **Every step is skippable.** If the user says "skip," move on without judgment.
- **Don't overwrite existing config.** If hooks, team config, or memory files already exist, confirm before changing anything.
- **Handle errors gracefully.** If an MCP tool fails, explain what happened and offer to retry or skip that step.
- **Keep it moving.** This is onboarding, not a tutorial. Be concise.
