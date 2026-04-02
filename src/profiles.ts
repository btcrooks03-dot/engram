import * as fs from "fs";
import * as path from "path";
import { PROFILES_DIR, MEMORY_INDEX } from "./constants.js";
import { ensureDir } from "./helpers.js";
import { getProjectKey } from "./scanning.js";

export function sanitizeProfileName(name: string): string {
  // Strip path traversal, slashes, and non-alphanumeric except hyphens/underscores
  return name.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

export function listProfiles(memoryDir: string): Array<{ name: string; created: string; fileCount: number }> {
  const projectKey = getProjectKey(memoryDir);
  const profileDir = path.join(PROFILES_DIR, projectKey);
  if (!fs.existsSync(profileDir)) return [];

  return fs
    .readdirSync(profileDir)
    .filter((d) => fs.statSync(path.join(profileDir, d)).isDirectory())
    .map((name) => {
      const profPath = path.join(profileDir, name);
      const files = fs.readdirSync(profPath).filter((f) => f.endsWith(".md"));
      const stat = fs.statSync(profPath);
      return { name, created: stat.birthtime.toISOString(), fileCount: files.length };
    });
}

export function saveProfile(memoryDir: string, profileName: string): string {
  const safeName = sanitizeProfileName(profileName);
  if (!safeName) return "Invalid profile name. Use alphanumeric characters, hyphens, or underscores.";
  const projectKey = getProjectKey(memoryDir);
  const profileDir = path.join(PROFILES_DIR, projectKey, safeName);

  if (fs.existsSync(profileDir)) {
    fs.rmSync(profileDir, { recursive: true });
  }
  ensureDir(profileDir);

  const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
  let copied = 0;
  for (const file of files) {
    fs.copyFileSync(path.join(memoryDir, file), path.join(profileDir, file));
    copied++;
  }

  return `Profile "${safeName}" saved with ${copied} files.`;
}

export function loadProfile(memoryDir: string, profileName: string): string {
  const safeName = sanitizeProfileName(profileName);
  if (!safeName) return "Invalid profile name.";
  const projectKey = getProjectKey(memoryDir);
  const profileDir = path.join(PROFILES_DIR, projectKey, safeName);

  if (!fs.existsSync(profileDir)) {
    return `Profile "${safeName}" not found. Use engram_profile_list to see available profiles.`;
  }

  // Validate profile contains MEMORY.md
  const profileFiles = fs.readdirSync(profileDir).filter((f) => f.endsWith(".md"));
  if (!profileFiles.includes(MEMORY_INDEX)) {
    return `Profile "${safeName}" is invalid — it does not contain a ${MEMORY_INDEX}. This profile may be corrupted.`;
  }

  // Backup current as "_previous"
  saveProfile(memoryDir, "_previous_auto_backup");

  // Clear current memory files
  const currentFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
  for (const file of currentFiles) {
    fs.unlinkSync(path.join(memoryDir, file));
  }

  // Copy profile files to memory dir
  let restored = 0;
  for (const file of profileFiles) {
    fs.copyFileSync(path.join(profileDir, file), path.join(memoryDir, file));
    restored++;
  }

  return `Profile "${safeName}" loaded (${restored} files). Previous state backed up as "_previous_auto_backup".`;
}

export function deleteProfile(memoryDir: string, profileName: string): string {
  const safeName = sanitizeProfileName(profileName);
  if (!safeName) return "Invalid profile name.";
  const projectKey = getProjectKey(memoryDir);
  const profileDir = path.join(PROFILES_DIR, projectKey, safeName);

  if (!fs.existsSync(profileDir)) {
    return `Profile "${safeName}" not found.`;
  }

  const fileCount = fs.readdirSync(profileDir).filter((f) => f.endsWith(".md")).length;
  fs.rmSync(profileDir, { recursive: true });
  return `Profile "${safeName}" deleted (${fileCount} files removed).`;
}

export function diffProfile(memoryDir: string, profileName: string): {
  onlyCurrent: string[];
  onlyProfile: string[];
  both: Array<{ file: string; changed: boolean; currentLines: number; profileLines: number }>;
} {
  const safeName = sanitizeProfileName(profileName);
  const projectKey = getProjectKey(memoryDir);
  const profileDir = path.join(PROFILES_DIR, projectKey, safeName);

  const currentFiles = new Set(fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md")));
  const profileFiles = new Set(
    fs.existsSync(profileDir) ? fs.readdirSync(profileDir).filter((f) => f.endsWith(".md")) : []
  );

  const onlyCurrent = [...currentFiles].filter((f) => !profileFiles.has(f));
  const onlyProfile = [...profileFiles].filter((f) => !currentFiles.has(f));
  const both = [...currentFiles]
    .filter((f) => profileFiles.has(f))
    .map((file) => {
      const currentContent = fs.readFileSync(path.join(memoryDir, file), "utf-8");
      const profileContent = fs.readFileSync(path.join(profileDir, file), "utf-8");
      return {
        file,
        changed: currentContent !== profileContent,
        currentLines: currentContent.length === 0 ? 0 : currentContent.split("\n").length,
        profileLines: profileContent.length === 0 ? 0 : profileContent.split("\n").length,
      };
    });

  return { onlyCurrent, onlyProfile, both };
}
