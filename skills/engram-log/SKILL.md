---
name: engram-log
description: View memory changelog — history of all memory operations (creates, edits, deletes, merges, profile switches) with timestamps. Run with /engram-log.
---

# Engram — Memory Changelog

Display the history of memory operations. Every time engram modifies memory (via optimize, suggest, profiles, or bootstrap), it logs the operation. This lets you see what changed and when without digging through git.

## Process

### Step 1: Retrieve Changelog

Call `engram_get_changelog` with the desired limit (default 20, or the number the user requests).

### Step 2: Display

Format the changelog:

```
Engram Memory Changelog
════════════════════════

  [timestamp]    [operation]       [files]              [details]
  2024-03-22     optimize          project_notes.md     Removed 3 derivable lines
  2024-03-22     merge_generated   notes.md, ctx.md     Similarity: 0.72, 8 lines saved
  2024-03-20     profile_switch    (all files)          Loaded "debugging" profile
  2024-03-18     create            user_role.md         Bootstrap: user memory created
  ...

Showing [n] of [total] entries.
```

If there are no entries, tell the user: "No changelog entries yet. The changelog records operations from /engram-optimize, /engram-suggest, /engram-profiles, and /engram-init."

### Step 3: Optional Filtering

If the user asks to filter (e.g., "show only merges" or "show last 5"), apply the filter to the results.

## Notes

- The changelog is stored persistently and survives across conversations
- Each entry includes: timestamp, operation type, affected files, and brief details
- Operations logged: create, edit, delete, merge, optimize, profile_switch, profile_save, bootstrap, deep_audit
- The changelog holds up to 200 entries (oldest are pruned)
