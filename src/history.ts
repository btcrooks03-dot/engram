import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { STORE_PATH, CHANGELOG_PATH, CHANGES_PATH, SNAPSHOTS_PATH, MEMORY_INDEX, STOP_WORDS } from "./constants.js";
import { readJson, writeJson } from "./helpers.js";
import { scanProjectMemory, getProjectKey, reverseProjectKey } from "./scanning.js";
import { tokenize } from "./analysis.js";
import type { AuditRecord, FileChange, ChangelogEntry, DerivableItem } from "./types.js";

export function loadHistory(): AuditRecord[] {
  return readJson(STORE_PATH) || [];
}

export function saveAuditRecord(record: AuditRecord) {
  const history = loadHistory();
  history.push(record);
  // Keep last 100 records
  while (history.length > 100) history.shift();
  writeJson(STORE_PATH, history);
}

export function loadChanges(): FileChange[] {
  return readJson(CHANGES_PATH) || [];
}

export function saveChanges(changes: FileChange[]) {
  // Keep last 200 entries
  while (changes.length > 200) changes.shift();
  writeJson(CHANGES_PATH, changes);
}

export function detectChanges(memoryDir: string): FileChange[] {
  const allSnapshots: Record<string, { size: number; mtime: number }> = readJson(SNAPSHOTS_PATH) || {};
  const changes: FileChange[] = [];
  const now = new Date().toISOString();
  const keysInThisDir = new Set<string>();

  try {
    const currentFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
    for (const file of currentFiles) {
      const fullPath = path.join(memoryDir, file);
      const stat = fs.statSync(fullPath);
      const key = fullPath;
      keysInThisDir.add(key);

      if (!allSnapshots[key]) {
        changes.push({ file, type: "added", timestamp: now, sizeDelta: stat.size });
      } else if (allSnapshots[key].mtime !== stat.mtimeMs) {
        changes.push({
          file,
          type: "modified",
          timestamp: now,
          sizeDelta: stat.size - allSnapshots[key].size,
        });
      }
      // Update snapshot for this file (merge, not overwrite)
      allSnapshots[key] = { size: stat.size, mtime: stat.mtimeMs };
    }

    // Check for deleted files (only within this memoryDir)
    for (const key of Object.keys(allSnapshots)) {
      if (key.startsWith(memoryDir + path.sep) && !keysInThisDir.has(key)) {
        const file = path.basename(key);
        changes.push({ file, type: "deleted", timestamp: now, sizeDelta: -allSnapshots[key].size });
        delete allSnapshots[key];
      }
    }
  } catch {}

  // Merge-write snapshots (preserves other projects' data)
  writeJson(SNAPSHOTS_PATH, allSnapshots);

  // Append to change history
  if (changes.length > 0) {
    const history = loadChanges();
    history.push(...changes);
    saveChanges(history);
  }

  return changes;
}

export function detectDerivableContent(memoryDir: string, projectDir?: string): DerivableItem[] {
  const project = scanProjectMemory(memoryDir, getProjectKey(memoryDir));
  if (!project) return [];

  const items: DerivableItem[] = [];

  // Determine project directory
  let searchDir = projectDir;
  if (!searchDir) {
    const key = getProjectKey(memoryDir);
    const reversed = reverseProjectKey(key);
    if (reversed && fs.existsSync(reversed)) searchDir = reversed;
  }

  for (const file of project.files) {
    const body = file.content.replace(/^---[\s\S]*?---\n?/, "");
    const lines = body.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Detect file paths (absolute or relative with extensions)
      const pathMatches = trimmed.match(/(?:`([^`]+\.[a-z]{1,10})`|(?:^|\s)((?:\.\/|\/|[a-zA-Z][\w-]*\/)[^\s,)]+\.[a-z]{1,10}))/g);
      if (pathMatches) {
        for (const pm of pathMatches) {
          const cleaned = pm.replace(/`/g, "").trim();
          // Check if file exists in project
          if (searchDir) {
            const fullPath = path.isAbsolute(cleaned) ? cleaned : path.join(searchDir, cleaned);
            if (fs.existsSync(fullPath)) {
              items.push({ file: file.filename, line: trimmed, type: "file_path", found_at: fullPath });
            }
          }
        }
      }

      // Detect CLI commands (backtick-wrapped commands or lines starting with common CLIs)
      const cmdMatch = trimmed.match(/`((?:py|python|python3|node|npm|npx|yarn|pnpm|git|docker|cargo|go|make|pip|curl|wget)\s[^`]+)`/);
      if (cmdMatch && searchDir) {
        // Check if command exists in package.json scripts, Makefile, or shell scripts
        try {
          const result = execSync(
            `grep -rl "${cmdMatch[1].slice(0, 40).replace(/"/g, '\\"')}" --include="*.json" --include="*.sh" --include="Makefile" --include="*.yaml" --include="*.yml" . 2>/dev/null | head -3`,
            { cwd: searchDir, encoding: "utf-8", timeout: 5000 }
          );
          if (result.trim()) {
            items.push({
              file: file.filename,
              line: trimmed,
              type: "cli_command",
              found_at: result.trim().split("\n")[0],
            });
          }
        } catch {}
      }

      // Detect function/class names (CamelCase or snake_case identifiers in backticks)
      const identMatches = trimmed.match(/`([A-Z][a-zA-Z0-9]+(?:\.[a-zA-Z]+)*)`|`([a-z][a-z0-9_]+(?:\.[a-z_]+)*)`/g);
      if (identMatches && searchDir) {
        for (const im of identMatches) {
          const ident = im.replace(/`/g, "");
          if (ident.length < 4 || STOP_WORDS.has(ident.toLowerCase())) continue;
          try {
            const result = execSync(
              `grep -rl "${ident}" --include="*.py" --include="*.js" --include="*.ts" --include="*.go" --include="*.rs" --include="*.java" . 2>/dev/null | head -2`,
              { cwd: searchDir, encoding: "utf-8", timeout: 5000 }
            );
            if (result.trim()) {
              items.push({
                file: file.filename,
                line: trimmed,
                type: "function_name",
                found_at: result.trim().split("\n")[0],
              });
            }
          } catch {}
        }
      }

      // Detect config values (KEY=value patterns, specific port numbers, URLs)
      const configMatch = trimmed.match(/`([A-Z_]{3,})\s*[=:]\s*([^`]+)`/);
      if (configMatch && searchDir) {
        try {
          const result = execSync(
            `grep -rl "${configMatch[1]}" --include="*.env" --include="*.yaml" --include="*.yml" --include="*.toml" --include="*.json" --include="*.cfg" . 2>/dev/null | head -2`,
            { cwd: searchDir, encoding: "utf-8", timeout: 5000 }
          );
          if (result.trim()) {
            items.push({
              file: file.filename,
              line: trimmed,
              type: "config_value",
              found_at: result.trim().split("\n")[0],
            });
          }
        } catch {}
      }
    }
  }

  return items;
}

export function logOperation(operation: string, files: string[], details: string) {
  const log: ChangelogEntry[] = readJson(CHANGELOG_PATH) || [];
  log.push({ timestamp: new Date().toISOString(), operation, files, details });
  while (log.length > 200) log.shift();
  writeJson(CHANGELOG_PATH, log);
}

export function getChangelog(limit: number = 20): ChangelogEntry[] {
  const log: ChangelogEntry[] = readJson(CHANGELOG_PATH) || [];
  return log.slice(-limit);
}
