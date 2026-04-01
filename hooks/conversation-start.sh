#!/bin/bash
# Engram: Conversation-start health check hook
# Quick, silent check at conversation start. Only outputs if there are issues.
#
# Install: Add to your Claude Code settings (settings.json):
# {
#   "hooks": {
#     "PostToolUse": [
#       {
#         "matcher": "Read",
#         "command": "~/.claude/plugins/marketplaces/engram/hooks/conversation-start.sh",
#         "runOnce": true
#       }
#     ]
#   }
# }

# Find memory directories
CLAUDE_DIR="$HOME/.claude"
PROJECTS_DIR="$CLAUDE_DIR/projects"

if [[ ! -d "$PROJECTS_DIR" ]]; then
  exit 0
fi

ISSUES=0
WARNINGS=""

for PROJ_DIR in "$PROJECTS_DIR"/*/; do
  MEMORY_DIR="${PROJ_DIR}memory"
  MEMORY_MD="${MEMORY_DIR}/MEMORY.md"

  if [[ ! -f "$MEMORY_MD" ]]; then
    continue
  fi

  PROJ_NAME=$(basename "$PROJ_DIR")

  # Check line cap
  LINE_COUNT=$(wc -l < "$MEMORY_MD" | tr -d ' ')
  if [[ $LINE_COUNT -gt 200 ]]; then
    WARNINGS="${WARNINGS}\n  CRITICAL: ${PROJ_NAME} — ${LINE_COUNT}/200 lines (TRUNCATING)"
    ISSUES=$((ISSUES + 1))
  elif [[ $LINE_COUNT -gt 170 ]]; then
    WARNINGS="${WARNINGS}\n  WARNING: ${PROJ_NAME} — ${LINE_COUNT}/200 lines (approaching cap)"
    ISSUES=$((ISSUES + 1))
  fi

  # Check for dead links (quick check)
  while IFS= read -r line; do
    LINKED_FILE=$(echo "$line" | grep -o '([^)]*\.md)' | tr -d '()')
    if [[ -n "$LINKED_FILE" && ! -f "${MEMORY_DIR}/${LINKED_FILE}" ]]; then
      WARNINGS="${WARNINGS}\n  WARNING: ${PROJ_NAME} — dead link: ${LINKED_FILE}"
      ISSUES=$((ISSUES + 1))
      break  # Only report first dead link per project
    fi
  done < "$MEMORY_MD"

  # Check for orphan files
  for MD_FILE in "${MEMORY_DIR}"/*.md; do
    [[ ! -f "$MD_FILE" ]] && continue
    BASENAME=$(basename "$MD_FILE")
    [[ "$BASENAME" == "MEMORY.md" ]] && continue
    if ! grep -q "$BASENAME" "$MEMORY_MD" 2>/dev/null; then
      WARNINGS="${WARNINGS}\n  WARNING: ${PROJ_NAME} — orphan file: ${BASENAME}"
      ISSUES=$((ISSUES + 1))
      break  # Only report first orphan per project
    fi
  done
done

if [[ $ISSUES -gt 0 ]]; then
  echo -e "ENGRAM: ${ISSUES} memory issue(s) detected. Run /engram-health for details.${WARNINGS}" >&2
fi
