#!/bin/bash
# Engram: Post-memory-write validation hook
# Fires after any Write tool use. Checks if the written file is in a memory directory.
# If so, validates caps and warns about issues.
#
# Install: Add to your Claude Code settings (settings.json):
# {
#   "hooks": {
#     "PostToolUse": [
#       {
#         "matcher": "Write",
#         "command": "~/.claude/plugins/marketplaces/engram/hooks/post-memory-write.sh \"$TOOL_INPUT_FILE_PATH\""
#       }
#     ]
#   }
# }

FILE_PATH="$1"

# Check if this is a memory file
if [[ "$FILE_PATH" != *"/.claude/projects/"*"/memory/"* ]]; then
  exit 0
fi

MEMORY_DIR=$(dirname "$FILE_PATH")
MEMORY_MD="$MEMORY_DIR/MEMORY.md"

if [[ ! -f "$MEMORY_MD" ]]; then
  exit 0
fi

# Check line cap
LINE_COUNT=$(wc -l < "$MEMORY_MD" | tr -d ' ')
if [[ $LINE_COUNT -gt 200 ]]; then
  echo "ENGRAM WARNING: MEMORY.md is at ${LINE_COUNT}/200 lines — content is being TRUNCATED!" >&2
elif [[ $LINE_COUNT -gt 150 ]]; then
  echo "ENGRAM WARNING: MEMORY.md is at ${LINE_COUNT}/200 lines — approaching cap" >&2
fi

# Check size cap (25KB = 25600 bytes)
BYTE_SIZE=$(wc -c < "$MEMORY_MD" | tr -d ' ')
if [[ $BYTE_SIZE -gt 25600 ]]; then
  echo "ENGRAM WARNING: MEMORY.md is ${BYTE_SIZE} bytes (cap: 25600) — content is being TRUNCATED!" >&2
elif [[ $BYTE_SIZE -gt 20480 ]]; then
  echo "ENGRAM WARNING: MEMORY.md is ${BYTE_SIZE} bytes — approaching 25KB cap" >&2
fi

# Check if the written file has valid frontmatter (only for .md files, not MEMORY.md itself)
BASENAME=$(basename "$FILE_PATH")
if [[ "$BASENAME" != "MEMORY.md" && "$BASENAME" == *.md ]]; then
  # Check for frontmatter
  FIRST_LINE=$(head -1 "$FILE_PATH")
  if [[ "$FIRST_LINE" != "---" ]]; then
    echo "ENGRAM WARNING: ${BASENAME} is missing YAML frontmatter (should start with ---)" >&2
  else
    # Check description length
    DESC=$(grep "^description:" "$FILE_PATH" | head -1 | sed 's/^description:\s*//')
    DESC_LEN=${#DESC}
    if [[ $DESC_LEN -lt 40 ]]; then
      echo "ENGRAM WARNING: ${BASENAME} description is only ${DESC_LEN} chars — aim for 40-100 chars for effective relevance matching" >&2
    fi
  fi

  # Check if file is linked from MEMORY.md
  if ! grep -q "$BASENAME" "$MEMORY_MD" 2>/dev/null; then
    echo "ENGRAM WARNING: ${BASENAME} is not linked from MEMORY.md — it will be invisible to Claude" >&2
  fi
fi
