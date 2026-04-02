import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { CLAUDE_DIR, MEMORY_INDEX, LINE_CAP, SIZE_CAP, STOP_WORDS } from "./constants.js";
import { parseFrontmatter, extractLinks } from "./helpers.js";
import type { MemoryFile, ProjectMemory, ClaudeMdFile, ClaudeMdIssue } from "./types.js";

export function getProjectKey(memoryDir: string): string {
  // Consistent project key derivation: use the directory name above "memory/"
  const parent = path.basename(path.dirname(memoryDir));
  return parent || "default";
}

export function reverseProjectKey(projectKey: string): string | null {
  // Claude Code project keys are absolute paths with / replaced by -
  // e.g., "-Users-ben-myproject" -> "/Users/ben/myproject"
  if (projectKey.startsWith("-")) {
    return projectKey.replace(/-/g, "/");
  }
  return null;
}

export function scanProjectMemory(memoryDir: string, projectName: string): ProjectMemory | null {
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

export function scanClaudeMd(projectDir?: string): { files: ClaudeMdFile[]; issues: ClaudeMdIssue[] } {
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
