#!/usr/bin/env node
/**
 * Engram post-install script
 * Merges engram hooks into Claude Code settings.json if not already present.
 * Safe: reads existing settings, only adds engram hooks, preserves everything else.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const PLUGIN_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const ENGRAM_HOOKS = {
  PostToolUse: [
    {
      matcher: "Write",
      hooks: [
        {
          type: "command",
          command: `${PLUGIN_DIR}/hooks/post-memory-write.sh "$TOOL_INPUT_FILE_PATH"`,
        },
      ],
    },
    {
      matcher: "Read",
      hooks: [
        {
          type: "command",
          command: `${PLUGIN_DIR}/hooks/conversation-start.sh`,
        },
      ],
    },
  ],
};

function isEngramHook(hook) {
  const cmd = hook.command || (hook.hooks && hook.hooks[0] && hook.hooks[0].command) || "";
  return typeof cmd === "string" && cmd.includes("engram/hooks/");
}

function run() {
  let settings = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
    } catch {
      console.error("engram: Could not parse settings.json, skipping hook setup.");
      console.error("engram: Run /engram-setup to configure hooks manually.");
      return;
    }
  }

  if (!settings.hooks) settings.hooks = {};
  let changed = false;

  for (const [event, hooks] of Object.entries(ENGRAM_HOOKS)) {
    if (!settings.hooks[event]) settings.hooks[event] = [];

    for (const newHook of hooks) {
      const alreadyExists = settings.hooks[event].some(isEngramHook);
      if (!alreadyExists) {
        settings.hooks[event].push(newHook);
        changed = true;
      }
    }
  }

  if (changed) {
    // Ensure directory exists
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
    console.log("engram: Hooks added to ~/.claude/settings.json");
    console.log("engram: Restart Claude Code for hooks to take effect.");
  } else {
    console.log("engram: Hooks already configured.");
  }
}

run();
