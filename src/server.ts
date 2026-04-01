import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Constants ───────────────────────────────────────────────────────────────

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const DATA_DIR = path.join(CLAUDE_DIR, "plugins", "data", "engram");
const STORE_PATH = path.join(DATA_DIR, "audit-history.json");
const PROFILES_DIR = path.join(DATA_DIR, "profiles");
const MEMORY_INDEX = "MEMORY.md";
const LINE_CAP = 200;
const SIZE_CAP = 25600; // 25KB
const CHANGELOG_PATH = path.join(DATA_DIR, "changelog.json");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filepath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJson(filepath: string, data: any) {
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

interface MemoryFile {
  filename: string;
  path: string;
  name: string;
  description: string;
  type: string;
  lines: number;
  bytes: number;
  content: string;
  mtime: string;
}

interface ProjectMemory {
  project: string;
  memoryDir: string;
  indexPath: string;
  indexLines: number;
  indexBytes: number;
  indexCapPct: number;
  sizeCapPct: number;
  files: MemoryFile[];
  orphans: string[];
  deadLinks: string[];
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      // strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      fm[key] = val;
    }
  }
  return fm;
}

function extractLinks(indexContent: string): Array<{ title: string; file: string }> {
  const links: Array<{ title: string; file: string }> = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(indexContent)) !== null) {
    links.push({ title: m[1], file: m[2] });
  }
  return links;
}

function scanProjectMemory(memoryDir: string, projectName: string): ProjectMemory | null {
  const indexPath = path.join(memoryDir, MEMORY_INDEX);
  if (!fs.existsSync(indexPath)) return null;

  const indexContent = fs.readFileSync(indexPath, "utf-8");
  const indexLines = indexContent.length === 0 ? 0 : indexContent.split("\n").length;
  const indexBytes = Buffer.byteLength(indexContent, "utf-8");

  const links = extractLinks(indexContent);
  const linkedFiles = new Set(links.map((l) => l.file));

  // Read linked memory files
  const files: MemoryFile[] = [];
  const deadLinks: string[] = [];

  for (const link of links) {
    const filePath = path.join(memoryDir, link.file);
    if (!fs.existsSync(filePath)) {
      deadLinks.push(link.file);
      continue;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const fm = parseFrontmatter(content);
    const stat = fs.statSync(filePath);
    files.push({
      filename: link.file,
      path: filePath,
      name: fm.name || "",
      description: fm.description || "",
      type: fm.type || "",
      lines: content.split("\n").length,
      bytes: Buffer.byteLength(content, "utf-8"),
      content,
      mtime: stat.mtime.toISOString(),
    });
  }

  // Find orphans
  const orphans: string[] = [];
  try {
    const allMd = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== MEMORY_INDEX);
    for (const f of allMd) {
      if (!linkedFiles.has(f)) orphans.push(f);
    }
  } catch {}

  return {
    project: projectName,
    memoryDir,
    indexPath,
    indexLines,
    indexBytes,
    indexCapPct: Math.round((indexLines / LINE_CAP) * 100),
    sizeCapPct: Math.round((indexBytes / SIZE_CAP) * 100),
    files,
    orphans,
    deadLinks,
  };
}

// ─── Duplicate Analysis ──────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "this", "that", "with", "from", "have", "been", "will", "would", "could",
  "should", "about", "their", "there", "when", "where", "which", "what", "they",
  "them", "then", "than", "these", "those", "each", "every", "some", "such",
  "into", "over", "after", "before", "between", "under", "through", "during",
  "also", "just", "only", "very", "more", "most", "other", "being", "does",
  "make", "made", "like", "well", "back", "even", "still", "here", "much",
  "many", "both", "same", "need", "know", "want", "take", "come", "look",
  "use", "used", "using", "file", "files", "line", "lines", "can", "not",
  "are", "was", "were", "for", "and", "but", "all", "any", "its", "has",
  "had", "how", "may", "new", "now", "old", "see", "way", "who", "did",
  "get", "got", "let", "say", "she", "too", "her",
]);

function tokenize(text: string): Set<string> {
  // Remove frontmatter, then extract words
  const body = text.replace(/^---[\s\S]*?---\n?/, "");
  const words = body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

interface DuplicatePair {
  file1: string;
  file2: string;
  similarity: number;
  sharedTopics: string[];
}

function analyzeDuplicates(files: MemoryFile[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const tokenSets = files.map((f) => ({ file: f.filename, tokens: tokenize(f.content) }));

  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const sim = jaccardSimilarity(tokenSets[i].tokens, tokenSets[j].tokens);
      if (sim > 0.2) {
        // Find shared significant words
        const shared = [...tokenSets[i].tokens].filter((w) => tokenSets[j].tokens.has(w));
        // Filter to longer, more meaningful words
        const topics = shared.filter((w) => w.length > 3).slice(0, 10);
        pairs.push({
          file1: tokenSets[i].file,
          file2: tokenSets[j].file,
          similarity: Math.round(sim * 100) / 100,
          sharedTopics: topics,
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

// ─── Git Integration ─────────────────────────────────────────────────────────

function gitMemoryLog(memoryDir: string, limit: number = 20): string[] {
  try {
    // Check if directory is in a git repo
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: memoryDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    const relPath = path.relative(gitRoot, memoryDir);
    const log = execSync(
      `git log --oneline --diff-filter=ACDMR --name-status -n ${limit} -- "${relPath}"`,
      { cwd: gitRoot, encoding: "utf-8", timeout: 10000 }
    );
    return log
      .split("\n")
      .filter((l) => l.trim().length > 0);
  } catch {
    return ["(not in a git repository or no history)"];
  }
}

function gitMemoryDiff(memoryDir: string, since?: string): string {
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: memoryDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const relPath = path.relative(gitRoot, memoryDir);
    const sinceArg = since ? `--since="${since}"` : "--since='7 days ago'";
    const diff = execSync(`git log ${sinceArg} --stat -- "${relPath}"`, {
      cwd: gitRoot,
      encoding: "utf-8",
      timeout: 10000,
    });
    return diff || "(no changes in period)";
  } catch {
    return "(not in a git repository)";
  }
}

// ─── Suggestions Engine ──────────────────────────────────────────────────────

interface Suggestion {
  type: "missing_feedback" | "missing_project" | "missing_reference" | "stale_candidate" | "pattern";
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

function generateSuggestions(project: ProjectMemory, projectDir?: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const existingTypes = new Set(project.files.map((f) => f.type));
  const existingContent = project.files.map((f) => f.content.toLowerCase()).join("\n");

  // Check type coverage
  if (!existingTypes.has("feedback")) {
    suggestions.push({
      type: "missing_feedback",
      title: "No feedback memories found",
      detail:
        "Feedback memories capture corrections and confirmations from the user. Without them, Claude may repeat mistakes or drift from validated approaches across conversations.",
      priority: "high",
    });
  }
  if (!existingTypes.has("reference")) {
    suggestions.push({
      type: "missing_reference",
      title: "No reference memories found",
      detail:
        "Reference memories point to external resources (dashboards, issue trackers, docs). They help Claude find information without the user having to re-explain where things are.",
      priority: "medium",
    });
  }

  // Check for stale project memories (older than 30 days)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const file of project.files) {
    if (file.type === "project" && new Date(file.mtime).getTime() < thirtyDaysAgo) {
      suggestions.push({
        type: "stale_candidate",
        title: `Project memory "${file.name}" may be stale`,
        detail: `Last modified ${file.mtime.split("T")[0]}. Project memories describe ongoing work and decay fast. Verify this is still current or remove it to free space.`,
        priority: "medium",
      });
    }
  }

  // Check for vague descriptions (primary signal for relevance matching)
  for (const file of project.files) {
    if (file.description.length < 30) {
      suggestions.push({
        type: "pattern",
        title: `Weak description in "${file.filename}"`,
        detail: `Description is only ${file.description.length} chars: "${file.description}". The description field is the PRIMARY signal for relevance matching — a Sonnet side-query uses it to pick the top 5 memories. Make it specific and searchable.`,
        priority: "high",
      });
    }
  }

  // Check capacity — suggest consolidation if near cap
  if (project.indexCapPct > 60) {
    suggestions.push({
      type: "pattern",
      title: "Memory index over 60% capacity",
      detail: `At ${project.indexLines}/${LINE_CAP} lines (${project.indexCapPct}%). Consider consolidating related memories or removing low-value entries before you hit the silent truncation wall.`,
      priority: project.indexCapPct > 80 ? "high" : "medium",
    });
  }

  // Analyze git history for patterns if project dir available
  if (projectDir && fs.existsSync(projectDir)) {
    try {
      // Look for frequently mentioned files/dirs in recent commits
      const log = execSync(`git log --oneline -50 2>/dev/null || true`, {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 10000,
      });
      const commitMessages = log.split("\n").filter((l) => l.trim());

      // Find repeated themes in commit messages not covered by memory
      const commitStopWords = new Set([
        "update", "updated", "updates", "remove", "removed", "removes",
        "refactor", "refactored", "refactors", "feature", "change", "changed",
        "changes", "commit", "fixing", "fixed", "adding", "added", "create",
        "created", "delete", "deleted", "implement", "implemented", "merge",
        "merged", "revert", "reverted", "cleanup", "improve", "improved",
        "handle", "handled", "include", "included", "modify", "modified",
        "support", "replace", "replaced", "rename", "renamed", "resolve",
        "resolved", "address", "adjust", "adjusted", "ensure", "initial",
        "should", "branch", "master", "origin", "squash", "cherry",
      ]);
      const words = commitMessages
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 4 && !commitStopWords.has(w) && !STOP_WORDS.has(w));
      const freq: Record<string, number> = {};
      for (const w of words) freq[w] = (freq[w] || 0) + 1;
      const topWords = Object.entries(freq)
        .filter(([, count]) => count >= 3)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([word]) => word);

      // Check if any frequent themes are missing from memory
      for (const word of topWords) {
        if (!existingContent.includes(word)) {
          suggestions.push({
            type: "pattern",
            title: `Recurring theme "${word}" not in memory`,
            detail: `The word "${word}" appears frequently in recent commit messages but isn't captured in any memory file. If this represents an important concept, pattern, or decision, consider adding it.`,
            priority: "low",
          });
        }
      }
    } catch {}
  }

  return suggestions;
}

// ─── CLAUDE.md Scanner ───────────────────────────────────────────────────────

interface ClaudeMdFile {
  path: string;
  scope: string; // "global", "project", "directory"
  lines: number;
  bytes: number;
  content: string;
}

interface ClaudeMdIssue {
  file: string;
  type: "bloat" | "contradiction" | "stale" | "overlap_with_memory" | "missing";
  detail: string;
  severity: "high" | "medium" | "low";
}

function scanClaudeMd(projectDir?: string): { files: ClaudeMdFile[]; issues: ClaudeMdIssue[] } {
  const files: ClaudeMdFile[] = [];
  const issues: ClaudeMdIssue[] = [];

  // Global CLAUDE.md
  const globalPath = path.join(CLAUDE_DIR, "CLAUDE.md");
  if (fs.existsSync(globalPath)) {
    const content = fs.readFileSync(globalPath, "utf-8");
    files.push({
      path: globalPath,
      scope: "global",
      lines: content.split("\n").length,
      bytes: Buffer.byteLength(content, "utf-8"),
      content,
    });
  }

  // Project-level CLAUDE.md files
  if (projectDir) {
    const projectClaudeMd = path.join(projectDir, "CLAUDE.md");
    if (fs.existsSync(projectClaudeMd)) {
      const content = fs.readFileSync(projectClaudeMd, "utf-8");
      files.push({
        path: projectClaudeMd,
        scope: "project",
        lines: content.split("\n").length,
        bytes: Buffer.byteLength(content, "utf-8"),
        content,
      });
    }

    // Also check for .claude/CLAUDE.md in project
    const dotClaudeMd = path.join(projectDir, ".claude", "CLAUDE.md");
    if (fs.existsSync(dotClaudeMd)) {
      const content = fs.readFileSync(dotClaudeMd, "utf-8");
      files.push({
        path: dotClaudeMd,
        scope: "project-dot",
        lines: content.split("\n").length,
        bytes: Buffer.byteLength(content, "utf-8"),
        content,
      });
    }

    // Search for directory-level CLAUDE.md files
    try {
      const findResult = execSync(
        `find "${projectDir}" -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*" -maxdepth 4 2>/dev/null || true`,
        { encoding: "utf-8", timeout: 10000 }
      );
      for (const p of findResult.split("\n").filter((l) => l.trim())) {
        if (!files.some((f) => f.path === p)) {
          const content = fs.readFileSync(p, "utf-8");
          files.push({
            path: p,
            scope: "directory",
            lines: content.split("\n").length,
            bytes: Buffer.byteLength(content, "utf-8"),
            content,
          });
        }
      }
    } catch {}
  }

  // Analyze issues
  for (const file of files) {
    // Bloat check
    if (file.lines > 100) {
      issues.push({
        file: file.path,
        type: "bloat",
        detail: `${file.lines} lines — long CLAUDE.md files dilute important instructions. Consider splitting into scoped files or trimming.`,
        severity: file.lines > 200 ? "high" : "medium",
      });
    }

    // Look for potentially stale content (TODO, FIXME, temporary, WIP)
    const stalePatterns = /\b(TODO|FIXME|HACK|WIP|temporary|temp fix|for now)\b/gi;
    const staleMatches = file.content.match(stalePatterns);
    if (staleMatches) {
      issues.push({
        file: file.path,
        type: "stale",
        detail: `Contains ${staleMatches.length} potentially stale marker(s): ${[...new Set(staleMatches)].join(", ")}. Review whether these are still applicable.`,
        severity: "medium",
      });
    }

    // Check for overly generic instructions
    const genericPatterns = [
      /always write clean code/i,
      /follow best practices/i,
      /write good tests/i,
      /be careful/i,
      /make sure to/i,
      /use descriptive variable names/i,
      /keep functions small/i,
      /document your code/i,
      /write readable code/i,
      /avoid magic numbers/i,
      /don't repeat yourself/i,
      /keep it simple/i,
      /use meaningful names/i,
      /write maintainable code/i,
      /handle errors properly/i,
      /use proper error handling/i,
      /follow the single responsibility/i,
      /write unit tests/i,
    ];
    const genericHits = genericPatterns.filter((p) => p.test(file.content));
    if (genericHits.length > 0) {
      issues.push({
        file: file.path,
        type: "bloat",
        detail: `Contains ${genericHits.length} generic instruction(s) that don't add value beyond Claude's defaults. Be specific about WHAT and WHY.`,
        severity: "low",
      });
    }
  }

  // Cross-check: look for overlap between CLAUDE.md and memory files
  // (this is called from the tool handler which passes memory content)

  if (files.length === 0 && projectDir) {
    issues.push({
      file: "(none)",
      type: "missing",
      detail: `No CLAUDE.md found for project at ${projectDir}. CLAUDE.md shapes Claude's behavior more directly than memory — consider creating one with project-specific instructions.`,
      severity: "medium",
    });
  }

  return { files, issues };
}

// ─── Memory Profiles ─────────────────────────────────────────────────────────

function listProfiles(memoryDir: string): Array<{ name: string; created: string; fileCount: number }> {
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

function sanitizeProfileName(name: string): string {
  // Strip path traversal, slashes, and non-alphanumeric except hyphens/underscores
  return name.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function getProjectKey(memoryDir: string): string {
  // Consistent project key derivation: use the directory name above "memory/"
  const parent = path.basename(path.dirname(memoryDir));
  return parent || "default";
}

function saveProfile(memoryDir: string, profileName: string): string {
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

function loadProfile(memoryDir: string, profileName: string): string {
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

function deleteProfile(memoryDir: string, profileName: string): string {
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

function diffProfile(memoryDir: string, profileName: string): {
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

// ─── Audit History ───────────────────────────────────────────────────────────

interface AuditRecord {
  timestamp: string;
  project: string;
  score: number;
  issueCount: number;
  lineUsage: number;
  sizeUsage: number;
  fileCount: number;
  details?: string;
}

function loadHistory(): AuditRecord[] {
  return readJson(STORE_PATH) || [];
}

function saveAuditRecord(record: AuditRecord) {
  const history = loadHistory();
  history.push(record);
  // Keep last 100 records
  while (history.length > 100) history.shift();
  writeJson(STORE_PATH, history);
}

// ─── File Change Tracking ────────────────────────────────────────────────────

interface FileChange {
  file: string;
  type: "added" | "modified" | "deleted";
  timestamp: string;
  sizeDelta?: number;
}

const CHANGES_PATH = path.join(DATA_DIR, "file-changes.json");

function loadChanges(): FileChange[] {
  return readJson(CHANGES_PATH) || [];
}

function saveChanges(changes: FileChange[]) {
  // Keep last 200 entries
  while (changes.length > 200) changes.shift();
  writeJson(CHANGES_PATH, changes);
}

const SNAPSHOTS_PATH = path.join(DATA_DIR, "file-snapshots.json");

function detectChanges(memoryDir: string): FileChange[] {
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

// ─── Derivable Content Detection ─────────────────────────────────────────────

interface DerivableItem {
  file: string;
  line: string;
  type: "file_path" | "cli_command" | "function_name" | "config_value";
  found_at: string;
}

function reverseProjectKey(projectKey: string): string | null {
  // Claude Code project keys are absolute paths with / replaced by -
  // e.g., "-Users-ben-myproject" -> "/Users/ben/myproject"
  if (projectKey.startsWith("-")) {
    return projectKey.replace(/-/g, "/");
  }
  return null;
}

function detectDerivableContent(memoryDir: string, projectDir?: string): DerivableItem[] {
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

// ─── Relevance Simulation ────────────────────────────────────────────────────

interface RelevanceScore {
  file: string;
  description: string;
  type: string;
  score: number;
  matchedTerms: string[];
}

function simulateRelevance(taskDescription: string, memoryDir: string): RelevanceScore[] {
  const project = scanProjectMemory(memoryDir, getProjectKey(memoryDir));
  if (!project) return [];

  const taskTokens = tokenize(taskDescription);

  return project.files
    .map((file) => {
      // Score based on description match (primary signal, as per claimed behavior)
      const descTokens = tokenize(file.description);
      const descSim = jaccardSimilarity(taskTokens, descTokens);

      // Also score content match (secondary signal)
      const contentTokens = tokenize(file.content);
      const contentSim = jaccardSimilarity(taskTokens, contentTokens);

      // Weighted: description is 70%, content is 30% (description is primary signal)
      const score = Math.round((descSim * 0.7 + contentSim * 0.3) * 1000) / 1000;

      // Find which task terms matched
      const matched = [...taskTokens].filter(
        (t) => descTokens.has(t) || contentTokens.has(t)
      );

      return {
        file: file.filename,
        description: file.description,
        type: file.type,
        score,
        matchedTerms: matched.slice(0, 10),
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── Description Generator ───────────────────────────────────────────────────

interface DescriptionSuggestion {
  file: string;
  currentDescription: string;
  currentLength: number;
  suggestedDescription: string;
  suggestedLength: number;
  reason: string;
}

function generateDescriptions(memoryDir: string): DescriptionSuggestion[] {
  const project = scanProjectMemory(memoryDir, getProjectKey(memoryDir));
  if (!project) return [];

  const suggestions: DescriptionSuggestion[] = [];

  // Build corpus-wide word frequencies for TF-IDF-like scoring
  const corpusFreq: Record<string, number> = {};
  const totalDocs = project.files.length;
  for (const file of project.files) {
    const uniqueWords = tokenize(file.content);
    for (const word of uniqueWords) {
      corpusFreq[word] = (corpusFreq[word] || 0) + 1;
    }
  }

  for (const file of project.files) {
    const needsImprovement =
      file.description.length < 30 ||
      /^(project|user|notes|info|data|config|settings|reference|feedback|details|context|misc)$/i.test(
        file.description.trim().split(/\s+/).slice(-1)[0] || ""
      );

    if (!needsImprovement) continue;

    // Extract distinctive terms from this file's content
    const body = file.content.replace(/^---[\s\S]*?---\n?/, "");
    const words = body
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

    // Count word frequency within this file
    const localFreq: Record<string, number> = {};
    for (const w of words) localFreq[w] = (localFreq[w] || 0) + 1;

    // Score by TF-IDF: high local frequency + low corpus frequency = distinctive
    const scored = Object.entries(localFreq)
      .map(([word, count]) => {
        const idf = Math.log((totalDocs + 1) / (corpusFreq[word] || 1));
        return { word, score: count * idf };
      })
      .sort((a, b) => b.score - a.score);

    // Take top distinctive terms
    const topTerms = scored.slice(0, 6).map((s) => s.word);

    // Build a description from the name, type, and top terms
    const typeLabel = file.type ? `${file.type} memory` : "memory";
    let suggested: string;

    if (topTerms.length >= 3) {
      // Construct from distinctive terms
      suggested = `${file.name || "Untitled"} — ${topTerms.slice(0, 4).join(", ")} (${typeLabel})`;
    } else {
      suggested = `${file.name || "Untitled"} — ${typeLabel} for ${topTerms.join(", ") || "general context"}`;
    }

    // Ensure it's in the sweet spot (40-100 chars)
    if (suggested.length > 100) suggested = suggested.slice(0, 97) + "...";
    if (suggested.length < 30) suggested = suggested + " — needs manual enrichment";

    suggestions.push({
      file: file.filename,
      currentDescription: file.description,
      currentLength: file.description.length,
      suggestedDescription: suggested,
      suggestedLength: suggested.length,
      reason:
        file.description.length < 30
          ? `Current description is only ${file.description.length} chars — too short for effective relevance matching`
          : "Current description uses generic terms that won't match specific task queries",
    });
  }

  return suggestions;
}

// ─── Smart Merge Generator ───────────────────────────────────────────────────

interface MergeResult {
  file1: string;
  file2: string;
  similarity: number;
  mergedFilename: string;
  mergedContent: string;
  mergedLines: number;
  originalTotalLines: number;
  linesSaved: number;
}

function generateMerge(memoryDir: string, file1: string, file2: string): MergeResult | string {
  const path1 = path.join(memoryDir, file1);
  const path2 = path.join(memoryDir, file2);

  if (!fs.existsSync(path1)) return `File not found: ${file1}`;
  if (!fs.existsSync(path2)) return `File not found: ${file2}`;

  const content1 = fs.readFileSync(path1, "utf-8");
  const content2 = fs.readFileSync(path2, "utf-8");

  const fm1 = parseFrontmatter(content1);
  const fm2 = parseFrontmatter(content2);

  const body1 = content1.replace(/^---[\s\S]*?---\n?/, "").trim();
  const body2 = content2.replace(/^---[\s\S]*?---\n?/, "").trim();

  // Deduplicate lines
  const lines1 = body1.split("\n").map((l) => l.trim()).filter((l) => l);
  const lines2 = body2.split("\n").map((l) => l.trim()).filter((l) => l);

  // Use normalized comparison to find duplicate lines
  const normalizedSet = new Set<string>();
  const mergedLines: string[] = [];

  for (const line of lines1) {
    const norm = line.toLowerCase().replace(/\s+/g, " ");
    if (!normalizedSet.has(norm)) {
      normalizedSet.add(norm);
      mergedLines.push(line);
    }
  }
  for (const line of lines2) {
    const norm = line.toLowerCase().replace(/\s+/g, " ");
    if (!normalizedSet.has(norm)) {
      normalizedSet.add(norm);
      mergedLines.push(line);
    }
  }

  // Merge frontmatter: prefer longer description, combine names
  const mergedName = fm1.name || fm2.name || "merged";
  const mergedDesc =
    (fm1.description || "").length >= (fm2.description || "").length
      ? fm1.description || fm2.description || ""
      : fm2.description || fm1.description || "";
  const mergedType = fm1.type || fm2.type || "project";

  const mergedContent = `---
name: ${mergedName}
description: ${mergedDesc}
type: ${mergedType}
---

${mergedLines.join("\n")}
`;

  const sim = jaccardSimilarity(tokenize(content1), tokenize(content2));
  const origTotal = content1.split("\n").length + content2.split("\n").length;

  return {
    file1,
    file2,
    similarity: Math.round(sim * 100) / 100,
    mergedFilename: file1, // Keep the first file's name
    mergedContent,
    mergedLines: mergedContent.split("\n").length,
    originalTotalLines: origTotal,
    linesSaved: origTotal - mergedContent.split("\n").length,
  };
}

// ─── Effectiveness Scoring ───────────────────────────────────────────────────

interface EffectivenessScore {
  file: string;
  name: string;
  type: string;
  score: number;
  breakdown: {
    descriptionQuality: number;
    freshness: number;
    uniqueness: number;
    density: number;
    typeAppropriateness: number;
  };
  issues: string[];
}

function calculateEffectiveness(memoryDir: string): EffectivenessScore[] {
  const project = scanProjectMemory(memoryDir, getProjectKey(memoryDir));
  if (!project) return [];

  // Precompute token sets for uniqueness scoring
  const allTokenSets = project.files.map((f) => ({
    file: f.filename,
    tokens: tokenize(f.content),
  }));

  const now = Date.now();
  const results: EffectivenessScore[] = [];

  for (let i = 0; i < project.files.length; i++) {
    const file = project.files[i];
    const issues: string[] = [];

    // 1. Description quality (0-25)
    let descQuality = 0;
    if (file.description.length >= 50) descQuality = 25;
    else if (file.description.length >= 30) descQuality = 15;
    else if (file.description.length >= 10) descQuality = 5;
    else { descQuality = 0; issues.push("Description too short for relevance matching"); }

    // Check description specificity — penalize generic words
    const descWords = file.description.toLowerCase().split(/\s+/);
    const genericDescWords = new Set(["info", "data", "notes", "stuff", "things", "misc", "general", "various"]);
    const genericCount = descWords.filter((w) => genericDescWords.has(w)).length;
    if (genericCount > 0) {
      descQuality = Math.max(0, descQuality - genericCount * 5);
      issues.push(`Description contains ${genericCount} generic term(s)`);
    }

    // 2. Freshness (0-25)
    let freshness = 25;
    const ageMs = now - new Date(file.mtime).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (file.type === "project") {
      // Project memories decay fast
      if (ageDays > 90) { freshness = 0; issues.push("Project memory >90 days old — likely stale"); }
      else if (ageDays > 30) { freshness = 10; issues.push("Project memory >30 days old — review for staleness"); }
      else if (ageDays > 14) freshness = 20;
    } else if (file.type === "reference") {
      // References decay slowly
      if (ageDays > 180) { freshness = 10; issues.push("Reference >6 months old — verify links still work"); }
    } else {
      // User and feedback memories are fairly stable
      if (ageDays > 365) { freshness = 15; issues.push("Memory >1 year old — verify still accurate"); }
    }

    // 3. Uniqueness (0-25) — how distinct is this from other memories?
    let uniqueness = 25;
    let maxSim = 0;
    for (let j = 0; j < allTokenSets.length; j++) {
      if (i === j) continue;
      const sim = jaccardSimilarity(allTokenSets[i].tokens, allTokenSets[j].tokens);
      if (sim > maxSim) maxSim = sim;
    }
    if (maxSim > 0.6) { uniqueness = 5; issues.push(`High overlap (${Math.round(maxSim * 100)}%) with another memory — consider merging`); }
    else if (maxSim > 0.4) { uniqueness = 15; issues.push(`Moderate overlap (${Math.round(maxSim * 100)}%) with another memory`); }

    // 4. Density (0-15) — useful content per line
    const body = file.content.replace(/^---[\s\S]*?---\n?/, "");
    const bodyLines = body.split("\n").filter((l) => l.trim());
    const totalLines = bodyLines.length;
    const emptyOrHeader = body.split("\n").filter((l) => !l.trim() || l.trim().startsWith("#")).length;
    const densityRatio = totalLines > 0 ? (totalLines - emptyOrHeader) / totalLines : 0;
    let density = Math.round(densityRatio * 15);
    if (totalLines < 2) { density = 5; issues.push("Very short memory — may not provide enough context"); }
    if (totalLines > 30) { density = Math.max(5, density - 5); issues.push("Long memory — consider trimming to essential information"); }

    // 5. Type appropriateness (0-10)
    let typeScore = 10;
    const validTypes = ["user", "feedback", "project", "reference"];
    if (!validTypes.includes(file.type)) {
      typeScore = 0;
      issues.push(`Invalid type "${file.type}" — must be one of: ${validTypes.join(", ")}`);
    }

    const total = descQuality + freshness + uniqueness + density + typeScore;

    results.push({
      file: file.filename,
      name: file.name,
      type: file.type,
      score: total,
      breakdown: {
        descriptionQuality: descQuality,
        freshness,
        uniqueness,
        density,
        typeAppropriateness: typeScore,
      },
      issues,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ─── Changelog ───────────────────────────────────────────────────────────────

interface ChangelogEntry {
  timestamp: string;
  operation: string;
  files: string[];
  details: string;
}

function logOperation(operation: string, files: string[], details: string) {
  const log: ChangelogEntry[] = readJson(CHANGELOG_PATH) || [];
  log.push({ timestamp: new Date().toISOString(), operation, files, details });
  while (log.length > 200) log.shift();
  writeJson(CHANGELOG_PATH, log);
}

function getChangelog(limit: number = 20): ChangelogEntry[] {
  const log: ChangelogEntry[] = readJson(CHANGELOG_PATH) || [];
  return log.slice(-limit);
}

// ─── Bootstrap / Onboarding ──────────────────────────────────────────────────

interface BootstrapSuggestion {
  type: "user" | "feedback" | "project" | "reference";
  name: string;
  description: string;
  reasoning: string;
  priority: "high" | "medium" | "low";
  content_hints: string[];
}

function bootstrapScan(projectDir: string): {
  projectInfo: Record<string, any>;
  suggestions: BootstrapSuggestion[];
} {
  const suggestions: BootstrapSuggestion[] = [];
  const projectInfo: Record<string, any> = { path: projectDir };

  // Detect language/framework
  const indicators: Record<string, string[]> = {
    python: ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile"],
    node: ["package.json", "node_modules"],
    rust: ["Cargo.toml"],
    go: ["go.mod"],
    java: ["pom.xml", "build.gradle"],
    ruby: ["Gemfile"],
    dotnet: ["*.csproj", "*.sln"],
  };

  const detectedLangs: string[] = [];
  for (const [lang, files] of Object.entries(indicators)) {
    for (const f of files) {
      if (f.includes("*")) {
        try {
          const result = execSync(`find "${projectDir}" -maxdepth 2 -name "${f}" 2>/dev/null | head -1`, {
            encoding: "utf-8",
            timeout: 5000,
          });
          if (result.trim()) detectedLangs.push(lang);
        } catch {}
      } else if (fs.existsSync(path.join(projectDir, f))) {
        detectedLangs.push(lang);
      }
    }
  }
  projectInfo.languages = [...new Set(detectedLangs)];

  // Check for common frameworks
  if (fs.existsSync(path.join(projectDir, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      projectInfo.frameworks = Object.keys(deps).filter((d) =>
        ["react", "vue", "angular", "next", "nuxt", "express", "fastify", "nest", "svelte"].includes(d)
      );
      projectInfo.packageName = pkg.name;
    } catch {}
  }

  // Check for existing CLAUDE.md
  projectInfo.hasClaudeMd = fs.existsSync(path.join(projectDir, "CLAUDE.md"));

  // Check git info
  try {
    const remoteUrl = execSync("git remote get-url origin 2>/dev/null || true", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (remoteUrl) projectInfo.gitRemote = remoteUrl;

    const recentAuthors = execSync("git log --format='%aN' -20 2>/dev/null | sort | uniq -c | sort -rn | head -3", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (recentAuthors) projectInfo.recentAuthors = recentAuthors;
  } catch {}

  // Check directory structure
  try {
    const dirs = execSync(`ls -d ${projectDir}/*/ 2>/dev/null | head -15`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    projectInfo.topDirs = dirs
      .split("\n")
      .filter((d) => d.trim())
      .map((d) => path.basename(d.replace(/\/$/, "")));
  } catch {}

  // Always suggest a user memory
  suggestions.push({
    type: "user",
    name: "User Role",
    description: "User's role, expertise, and how to tailor responses",
    reasoning: "Every project benefits from Claude knowing who it's working with. This should capture role, technical expertise level, and communication preferences.",
    priority: "high",
    content_hints: [
      "What is your role? (developer, manager, data scientist, etc.)",
      "What's your experience level with the languages/frameworks in this project?",
      "Any preferences for how Claude should communicate? (terse vs detailed, etc.)",
    ],
  });

  // Always suggest feedback memory
  suggestions.push({
    type: "feedback",
    name: "Working Preferences",
    description: "Corrections and confirmed approaches for this project",
    reasoning: "Feedback memories prevent Claude from repeating mistakes. Start with any strong preferences you already know (testing style, commit conventions, etc.).",
    priority: "high",
    content_hints: [
      "Any approaches you've found work well or poorly with Claude?",
      "Testing preferences (unit vs integration, mocking vs real, etc.)",
      "Code style preferences not captured in linters/formatters",
    ],
  });

  // Suggest project memory if there are enough indicators
  if (projectInfo.languages?.length > 0 || projectInfo.frameworks?.length > 0) {
    suggestions.push({
      type: "project",
      name: "Project Context",
      description: `${projectInfo.packageName || "Project"} — ${(projectInfo.languages || []).join("/")} ${(projectInfo.frameworks || []).join("/")} project context`,
      reasoning: "Captures the non-obvious aspects of your project that Claude can't derive from just reading code — the 'why' behind architecture decisions, current priorities, known gotchas.",
      priority: "medium",
      content_hints: [
        "What is this project? (one sentence)",
        "Any non-obvious architecture decisions and WHY they were made?",
        "Current priorities or active work areas?",
        "Known gotchas or things that often trip people up?",
      ],
    });
  }

  // Suggest reference memory
  suggestions.push({
    type: "reference",
    name: "External Resources",
    description: "Pointers to dashboards, issue trackers, docs, and external tools",
    reasoning: "Reference memories save you from re-explaining where things are every conversation. Point to your issue tracker, CI/CD, monitoring, docs, etc.",
    priority: "medium",
    content_hints: [
      "Where are bugs/features tracked? (Linear, Jira, GitHub Issues, etc.)",
      "Any monitoring dashboards? (Grafana, Datadog, etc.)",
      "Where are the docs? (Notion, Confluence, README, etc.)",
      "Any external APIs or services this project depends on?",
    ],
  });

  return { projectInfo, suggestions };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════════════════════════════════════════════

const server = new McpServer({
  name: "engram",
  version: "2.0.0",
});

// ─── Tool: Scan All Projects ─────────────────────────────────────────────────

server.tool(
  "engram_scan_all_projects",
  "Scan memory across ALL Claude Code projects. Returns unified view of every project's memory: files, caps, orphans, dead links. Use this for cross-project duplicate detection and global memory health.",
  {},
  async () => {
    const results: ProjectMemory[] = [];

    if (fs.existsSync(PROJECTS_DIR)) {
      for (const projectKey of fs.readdirSync(PROJECTS_DIR)) {
        const memoryDir = path.join(PROJECTS_DIR, projectKey, "memory");
        if (fs.existsSync(memoryDir)) {
          const result = scanProjectMemory(memoryDir, projectKey);
          if (result) results.push(result);
        }
      }
    }

    // Also detect cross-project duplicates
    const allFiles: Array<MemoryFile & { project: string }> = [];
    for (const proj of results) {
      for (const f of proj.files) {
        allFiles.push({ ...f, project: proj.project });
      }
    }

    // Precompute token sets to avoid O(n^2) tokenize calls
    const tokenCache = allFiles.map((f) => ({ ...f, tokens: tokenize(f.content) }));

    const crossDupes: Array<{ file1: string; project1: string; file2: string; project2: string; similarity: number }> = [];
    for (let i = 0; i < tokenCache.length; i++) {
      for (let j = i + 1; j < tokenCache.length; j++) {
        if (tokenCache[i].project === tokenCache[j].project) continue;
        const sim = jaccardSimilarity(tokenCache[i].tokens, tokenCache[j].tokens);
        if (sim > 0.3) {
          crossDupes.push({
            file1: tokenCache[i].filename,
            project1: tokenCache[i].project,
            file2: tokenCache[j].filename,
            project2: tokenCache[j].project,
            similarity: Math.round(sim * 100) / 100,
          });
        }
      }
    }

    // Detect file changes for each project
    for (const proj of results) {
      detectChanges(proj.memoryDir);
    }

    const summary = {
      totalProjects: results.length,
      projects: results.map((r) => ({
        project: r.project,
        files: r.files.length,
        indexLines: r.indexLines,
        indexCapPct: r.indexCapPct,
        sizeCapPct: r.sizeCapPct,
        orphans: r.orphans.length,
        deadLinks: r.deadLinks.length,
        types: {
          user: r.files.filter((f) => f.type === "user").length,
          feedback: r.files.filter((f) => f.type === "feedback").length,
          project: r.files.filter((f) => f.type === "project").length,
          reference: r.files.filter((f) => f.type === "reference").length,
          unknown: r.files.filter((f) => !["user", "feedback", "project", "reference"].includes(f.type)).length,
        },
      })),
      crossProjectDuplicates: crossDupes,
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
  }
);

// ─── Tool: Analyze Duplicates ────────────────────────────────────────────────

server.tool(
  "engram_analyze_duplicates",
  "Rigorous duplicate and overlap detection using Jaccard similarity on tokenized content. Returns similarity scores for all memory file pairs above threshold. More reliable than subjective comparison.",
  { memory_dir: z.string().describe("Path to the memory directory containing .md files") },
  async ({ memory_dir }) => {
    const project = scanProjectMemory(memory_dir, path.basename(path.dirname(memory_dir)));
    if (!project) return { content: [{ type: "text" as const, text: "No MEMORY.md found in " + memory_dir }] };

    const duplicates = analyzeDuplicates(project.files);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              totalFiles: project.files.length,
              pairsAnalyzed: (project.files.length * (project.files.length - 1)) / 2,
              duplicatesFound: duplicates.length,
              pairs: duplicates.map((d) => ({
                ...d,
                recommendation:
                  d.similarity > 0.6
                    ? "MERGE — high overlap, likely redundant"
                    : d.similarity > 0.4
                      ? "REVIEW — moderate overlap, may benefit from dedup"
                      : "MONITOR — some shared topics but likely distinct",
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool: Save Audit ────────────────────────────────────────────────────────

server.tool(
  "engram_save_audit",
  "Persist an audit result to history. Call this after running /engram to track health score, cap usage, and issue counts over time.",
  {
    project: z.string().describe("Project identifier"),
    score: z.number().describe("Health score 0-100"),
    issues_count: z.number().describe("Number of issues found"),
    line_usage: z.number().describe("MEMORY.md line count"),
    size_usage: z.number().describe("MEMORY.md byte size"),
    file_count: z.number().describe("Number of memory files"),
    details: z.string().optional().describe("Optional details or notes"),
  },
  async ({ project, score, issues_count, line_usage, size_usage, file_count, details }) => {
    const record: AuditRecord = {
      timestamp: new Date().toISOString(),
      project,
      score,
      issueCount: issues_count,
      lineUsage: line_usage,
      sizeUsage: size_usage,
      fileCount: file_count,
      details,
    };
    saveAuditRecord(record);
    return { content: [{ type: "text" as const, text: `Audit saved. Total records: ${loadHistory().length}` }] };
  }
);

// ─── Tool: Get History ───────────────────────────────────────────────────────

server.tool(
  "engram_get_history",
  "Retrieve audit history to see health score trends, cap usage over time, and whether optimizations helped.",
  {
    project: z.string().optional().describe("Filter by project (optional)"),
    limit: z.number().optional().describe("Number of records to return (default 10)"),
  },
  async ({ project, limit }) => {
    let history = loadHistory();
    if (project) history = history.filter((r) => r.project === project);
    const n = limit || 10;
    const recent = history.slice(-n);

    let trend = "insufficient data";
    if (recent.length >= 2) {
      const first = recent[0].score;
      const last = recent[recent.length - 1].score;
      trend = last > first ? "improving" : last < first ? "declining" : "stable";
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ totalRecords: history.length, trend, records: recent }, null, 2),
        },
      ],
    };
  }
);

// ─── Tool: Suggest Memories ──────────────────────────────────────────────────

server.tool(
  "engram_suggest_memories",
  "Generative suggestions — analyzes existing memory gaps, type coverage, description quality, git patterns, and staleness to suggest what SHOULD be in memory. The flip side of /engram-optimize.",
  {
    memory_dir: z.string().describe("Path to the memory directory"),
    project_dir: z.string().optional().describe("Path to the project root (for git analysis)"),
  },
  async ({ memory_dir, project_dir }) => {
    const project = scanProjectMemory(memory_dir, path.basename(path.dirname(memory_dir)));
    if (!project) return { content: [{ type: "text" as const, text: "No MEMORY.md found" }] };

    const suggestions = generateSuggestions(project, project_dir);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              totalSuggestions: suggestions.length,
              byPriority: {
                high: suggestions.filter((s) => s.priority === "high").length,
                medium: suggestions.filter((s) => s.priority === "medium").length,
                low: suggestions.filter((s) => s.priority === "low").length,
              },
              suggestions,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool: CLAUDE.md Audit ───────────────────────────────────────────────────

server.tool(
  "engram_scan_claudemd",
  "Audit all CLAUDE.md files — global, project, and directory-level. Detects bloat, stale markers, generic instructions, and missing files. Also cross-references with memory for overlap.",
  {
    project_dir: z.string().optional().describe("Project root directory to scan"),
  },
  async ({ project_dir }) => {
    const result = scanClaudeMd(project_dir);

    // Cross-reference with memory if we can find it
    if (project_dir) {
      // Try to find the memory dir for this project
      // Claude Code uses the absolute path with slashes replaced by hyphens, with leading hyphen
      const projectKey = project_dir.replace(/\//g, "-");
      const possibleMemoryDir = path.join(PROJECTS_DIR, projectKey, "memory");
      // Also try without leading hyphen
      const altKey = projectKey.replace(/^-/, "");
      const altMemoryDir = path.join(PROJECTS_DIR, altKey, "memory");
      const actualMemoryDir = fs.existsSync(possibleMemoryDir)
        ? possibleMemoryDir
        : fs.existsSync(altMemoryDir)
          ? altMemoryDir
          : null;
      if (actualMemoryDir) {
        const project = scanProjectMemory(actualMemoryDir, projectKey);
        if (project) {
          // Check for overlap between CLAUDE.md content and memory content
          for (const claudeFile of result.files) {
            for (const memFile of project.files) {
              const sim = jaccardSimilarity(tokenize(claudeFile.content), tokenize(memFile.content));
              if (sim > 0.2) {
                result.issues.push({
                  file: claudeFile.path,
                  type: "overlap_with_memory",
                  detail: `Significant overlap (${Math.round(sim * 100)}%) with memory file "${memFile.filename}". CLAUDE.md and memory serve different purposes — CLAUDE.md for deterministic instructions, memory for contextual recall. Deduplicate.`,
                  severity: sim > 0.35 ? "high" : "medium",
                });
              }
            }
          }
        }
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              filesFound: result.files.length,
              files: result.files.map((f) => ({
                path: f.path,
                scope: f.scope,
                lines: f.lines,
                bytes: f.bytes,
              })),
              issuesFound: result.issues.length,
              issues: result.issues,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool: Profile List ──────────────────────────────────────────────────────

server.tool(
  "engram_profile_list",
  "List saved memory profiles for a project. Profiles are named snapshots of memory state that can be swapped for different workflows.",
  { memory_dir: z.string().describe("Path to the memory directory") },
  async ({ memory_dir }) => {
    const profiles = listProfiles(memory_dir);
    return { content: [{ type: "text" as const, text: JSON.stringify({ profiles }, null, 2) }] };
  }
);

// ─── Tool: Profile Save ─────────────────────────────────────────────────────

server.tool(
  "engram_profile_save",
  "Snapshot current memory state as a named profile. Use before switching workflows (e.g., save 'debugging' profile before switching to 'feature-work').",
  {
    memory_dir: z.string().describe("Path to the memory directory"),
    profile_name: z.string().describe("Name for the profile (e.g., 'debugging', 'feature-work', 'refactoring')"),
  },
  async ({ memory_dir, profile_name }) => {
    const result = saveProfile(memory_dir, profile_name);
    return { content: [{ type: "text" as const, text: result }] };
  }
);

// ─── Tool: Profile Load ─────────────────────────────────────────────────────

server.tool(
  "engram_profile_load",
  "Restore a saved memory profile, replacing current memory state. Automatically backs up current state first.",
  {
    memory_dir: z.string().describe("Path to the memory directory"),
    profile_name: z.string().describe("Name of the profile to load"),
  },
  async ({ memory_dir, profile_name }) => {
    const result = loadProfile(memory_dir, profile_name);
    return { content: [{ type: "text" as const, text: result }] };
  }
);

// ─── Tool: Profile Delete ────────────────────────────────────────────────────

server.tool(
  "engram_profile_delete",
  "Delete a saved memory profile permanently.",
  {
    memory_dir: z.string().describe("Path to the memory directory"),
    profile_name: z.string().describe("Name of the profile to delete"),
  },
  async ({ memory_dir, profile_name }) => {
    const result = deleteProfile(memory_dir, profile_name);
    return { content: [{ type: "text" as const, text: result }] };
  }
);

// ─── Tool: Profile Diff ─────────────────────────────────────────────────────

server.tool(
  "engram_profile_diff",
  "Compare current memory state with a saved profile. Shows files only in current, only in profile, and files in both with change status.",
  {
    memory_dir: z.string().describe("Path to the memory directory"),
    profile_name: z.string().describe("Name of the profile to compare against"),
  },
  async ({ memory_dir, profile_name }) => {
    const diff = diffProfile(memory_dir, profile_name);
    return { content: [{ type: "text" as const, text: JSON.stringify(diff, null, 2) }] };
  }
);

// ─── Tool: Git Memory Log ────────────────────────────────────────────────────

server.tool(
  "engram_memory_git_log",
  "Track memory file changes via git history — when entries were added, modified, or deleted. Shows memory drift over time.",
  {
    memory_dir: z.string().describe("Path to the memory directory"),
    limit: z.number().optional().describe("Number of git log entries (default 20)"),
    since: z.string().optional().describe("Show changes since date (e.g., '7 days ago', '2024-01-01')"),
  },
  async ({ memory_dir, limit, since }) => {
    const log = gitMemoryLog(memory_dir, limit || 20);
    const diff = since ? gitMemoryDiff(memory_dir, since) : gitMemoryDiff(memory_dir);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              gitLog: log,
              recentChanges: diff,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool: Watch Status ──────────────────────────────────────────────────────

server.tool(
  "engram_watch_status",
  "Check for memory file changes since last check. Compares file mtimes and sizes against last snapshot. Reports additions, modifications, deletions, and cap warnings.",
  {
    memory_dir: z.string().describe("Path to the memory directory"),
  },
  async ({ memory_dir }) => {
    const changes = detectChanges(memory_dir);
    const history = loadChanges();

    // Check current cap status
    const indexPath = path.join(memory_dir, MEMORY_INDEX);
    let capWarning: string | null = null;
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, "utf-8");
      const lines = content.split("\n").length;
      const bytes = Buffer.byteLength(content, "utf-8");
      if (lines > LINE_CAP) capWarning = `CRITICAL: ${lines}/${LINE_CAP} lines — content is being truncated!`;
      else if (lines > 150) capWarning = `WARNING: ${lines}/${LINE_CAP} lines — approaching cap`;
      if (bytes > SIZE_CAP)
        capWarning = (capWarning ? capWarning + " | " : "") + `CRITICAL: ${bytes}/${SIZE_CAP} bytes — over size cap!`;
      else if (bytes > 20480)
        capWarning = (capWarning ? capWarning + " | " : "") + `WARNING: ${bytes}/${SIZE_CAP} bytes — approaching size cap`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              currentChanges: changes,
              recentHistory: history.slice(-20),
              capWarning,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool: Detect Derivable Content ──────────────────────────────────────────

server.tool(
  "engram_detect_derivable",
  "Deterministic derivable content detection — scans memory files for file paths, CLI commands, function names, and config values, then checks if they exist in the project codebase. Returns computed results, not LLM guesses.",
  {
    memory_dir: z.string().describe("Path to the memory directory"),
    project_dir: z.string().optional().describe("Path to the project root (for codebase scanning)"),
  },
  async ({ memory_dir, project_dir }) => {
    const items = detectDerivableContent(memory_dir, project_dir);
    const byType = {
      file_paths: items.filter((i) => i.type === "file_path").length,
      cli_commands: items.filter((i) => i.type === "cli_command").length,
      function_names: items.filter((i) => i.type === "function_name").length,
      config_values: items.filter((i) => i.type === "config_value").length,
    };
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ totalFound: items.length, byType, items }, null, 2),
      }],
    };
  }
);

// ─── Tool: Simulate Relevance ────────────────────────────────────────────────

server.tool(
  "engram_simulate_relevance",
  "Simulate which memories would be selected for a given task. Scores each memory's description and content against the task description, ranked by likely relevance. Shows the predicted top 5.",
  {
    task_description: z.string().describe("Description of the task or conversation topic to simulate"),
    memory_dir: z.string().describe("Path to the memory directory"),
  },
  async ({ task_description, memory_dir }) => {
    const scores = simulateRelevance(task_description, memory_dir);
    const top5 = scores.slice(0, 5);
    const rest = scores.slice(5);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          taskDescription: task_description,
          predictedSelection: top5.map((s, i) => ({ rank: i + 1, ...s })),
          notSelected: rest.map((s) => ({ file: s.file, score: s.score, description: s.description })),
          note: "Scores are estimates based on token overlap. Actual selection uses a Sonnet side-query which may weight differently.",
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Generate Descriptions ─────────────────────────────────────────────

server.tool(
  "engram_generate_descriptions",
  "Generate improved descriptions for memory files with weak or generic descriptions. Uses TF-IDF-like scoring to extract distinctive terms. Returns ready-to-apply replacements.",
  { memory_dir: z.string().describe("Path to the memory directory") },
  async ({ memory_dir }) => {
    const suggestions = generateDescriptions(memory_dir);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          totalSuggestions: suggestions.length,
          suggestions,
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Generate Merge ────────────────────────────────────────────────────

server.tool(
  "engram_generate_merge",
  "Generate a deduplicated merge of two memory files. Combines frontmatter, removes duplicate lines, preserves unique content from both. Returns the merged content ready to write.",
  {
    memory_dir: z.string().describe("Path to the memory directory"),
    file1: z.string().describe("First filename (e.g., 'project_notes.md')"),
    file2: z.string().describe("Second filename (e.g., 'project_context.md')"),
  },
  async ({ memory_dir, file1, file2 }) => {
    const result = generateMerge(memory_dir, file1, file2);
    if (typeof result === "string") {
      return { content: [{ type: "text" as const, text: result }] };
    }
    logOperation("merge_generated", [file1, file2], `Similarity: ${result.similarity}, lines saved: ${result.linesSaved}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── Tool: Effectiveness Scores ──────────────────────────────────────────────

server.tool(
  "engram_effectiveness",
  "Per-file effectiveness scoring (0-100) based on description quality, freshness, uniqueness, density, and type appropriateness. Identifies which memories are pulling their weight and which are dead weight.",
  { memory_dir: z.string().describe("Path to the memory directory") },
  async ({ memory_dir }) => {
    const scores = calculateEffectiveness(memory_dir);
    const avg = scores.length > 0 ? Math.round(scores.reduce((s, e) => s + e.score, 0) / scores.length) : 0;
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          averageScore: avg,
          totalFiles: scores.length,
          excellent: scores.filter((s) => s.score >= 80).length,
          good: scores.filter((s) => s.score >= 60 && s.score < 80).length,
          needsWork: scores.filter((s) => s.score >= 40 && s.score < 60).length,
          poor: scores.filter((s) => s.score < 40).length,
          files: scores,
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: Log Operation ─────────────────────────────────────────────────────

server.tool(
  "engram_log_operation",
  "Log a memory operation to the changelog. Call this after any memory modification (create, edit, delete, merge, profile switch).",
  {
    operation: z.string().describe("Operation type (create, edit, delete, merge, optimize, profile_switch, profile_save)"),
    files: z.array(z.string()).describe("Files affected"),
    details: z.string().describe("Brief description of what changed"),
  },
  async ({ operation, files, details }) => {
    logOperation(operation, files, details);
    return { content: [{ type: "text" as const, text: `Logged: ${operation} on ${files.join(", ")}` }] };
  }
);

// ─── Tool: Get Changelog ─────────────────────────────────────────────────────

server.tool(
  "engram_get_changelog",
  "Retrieve the memory changelog — a history of all memory operations (creates, edits, deletes, merges, profile switches) with timestamps.",
  { limit: z.number().optional().describe("Number of entries to return (default 20)") },
  async ({ limit }) => {
    const entries = getChangelog(limit || 20);
    return { content: [{ type: "text" as const, text: JSON.stringify({ entries, totalEntries: entries.length }, null, 2) }] };
  }
);

// ─── Tool: Bootstrap Scan ────────────────────────────────────────────────────

server.tool(
  "engram_bootstrap",
  "Scan a project directory and suggest starter memory files. Detects language, framework, git info, and directory structure. Returns structured suggestions for user, feedback, project, and reference memories.",
  { project_dir: z.string().describe("Path to the project root directory") },
  async ({ project_dir }) => {
    if (!fs.existsSync(project_dir)) {
      return { content: [{ type: "text" as const, text: `Directory not found: ${project_dir}` }] };
    }
    const result = bootstrapScan(project_dir);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  ensureDir(DATA_DIR);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Engram MCP server failed to start:", err);
  process.exit(1);
});
