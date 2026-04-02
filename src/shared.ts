import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DATA_DIR, MEMORY_INDEX, LINE_CAP, SIZE_CAP, STOP_WORDS } from "./constants.js";
import { readJson, writeJson, ensureDir, parseFrontmatter, extractLinks } from "./helpers.js";
import { scanProjectMemory, getProjectKey } from "./scanning.js";
import type { MemoryFile, ProjectMemory, EffectivenessScore } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TeamConfig {
  team_name: string;
  shared_memory_dir: string;
  sync_mode: "read-only" | "read-write";
  last_synced?: string;
}

interface SharedMemoryFile extends MemoryFile {
  source: "shared";
}

interface CombinedMemoryView {
  personal: MemoryFile[];
  shared: SharedMemoryFile[];
  total: number;
}

interface TeamContributor {
  name: string;
  memory_dir: string;
  file_count: number;
  types: Record<string, number>;
  last_updated: string;
  health: "good" | "needs-attention" | "minimal";
}

interface TeamHealthReport {
  team_name: string;
  shared_memory_dir: string;
  is_git_repo: boolean;
  shared_files: number;
  shared_effectiveness: EffectivenessScore[];
  contributors: TeamContributor[];
  common_gaps: string[];
  coverage: {
    types_present: string[];
    types_missing: string[];
  };
}

// ─── Config ─────────────────────────────────────────────────────────────────

const TEAM_CONFIG_PATH = path.join(DATA_DIR, "team-config.json");

export function loadTeamConfig(): TeamConfig | null {
  return readJson(TEAM_CONFIG_PATH) as TeamConfig | null;
}

export function saveTeamConfig(config: TeamConfig): void {
  writeJson(TEAM_CONFIG_PATH, config);
}

// ─── Shared Memory Scanning ─────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
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

function calculateEffectivenessForFiles(files: MemoryFile[]): EffectivenessScore[] {
  const allTokenSets = files.map((f) => ({
    file: f.filename,
    tokens: tokenize(f.content),
  }));

  const now = Date.now();
  const results: EffectivenessScore[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const issues: string[] = [];

    // 1. Description quality (0-25)
    let descQuality = 0;
    if (file.description.length >= 50) descQuality = 25;
    else if (file.description.length >= 30) descQuality = 15;
    else if (file.description.length >= 10) descQuality = 5;
    else { descQuality = 0; issues.push("Description too short for relevance matching"); }

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
      if (ageDays > 90) { freshness = 0; issues.push("Project memory >90 days old — likely stale"); }
      else if (ageDays > 30) { freshness = 10; issues.push("Project memory >30 days old — review for staleness"); }
      else if (ageDays > 14) freshness = 20;
    } else if (file.type === "reference") {
      if (ageDays > 180) { freshness = 10; issues.push("Reference >6 months old — verify links still work"); }
    } else {
      if (ageDays > 365) { freshness = 15; issues.push("Memory >1 year old — verify still accurate"); }
    }

    // 3. Uniqueness (0-25)
    let uniqueness = 25;
    let maxSim = 0;
    for (let j = 0; j < allTokenSets.length; j++) {
      if (i === j) continue;
      const sim = jaccardSimilarity(allTokenSets[i].tokens, allTokenSets[j].tokens);
      if (sim > maxSim) maxSim = sim;
    }
    if (maxSim > 0.6) { uniqueness = 5; issues.push(`High overlap (${Math.round(maxSim * 100)}%) with another memory — consider merging`); }
    else if (maxSim > 0.4) { uniqueness = 15; issues.push(`Moderate overlap (${Math.round(maxSim * 100)}%) with another memory`); }

    // 4. Density (0-15)
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

function scanSharedMemoryDir(sharedDir: string): SharedMemoryFile[] {
  if (!fs.existsSync(sharedDir)) return [];

  const files: SharedMemoryFile[] = [];
  try {
    const mdFiles = fs.readdirSync(sharedDir).filter((f) => f.endsWith(".md"));
    for (const filename of mdFiles) {
      const filePath = path.join(sharedDir, filename);
      const content = fs.readFileSync(filePath, "utf-8");
      const fm = parseFrontmatter(content);
      const stat = fs.statSync(filePath);
      files.push({
        filename,
        path: filePath,
        name: fm.name || filename.replace(/\.md$/, ""),
        description: fm.description || "",
        type: fm.type || "",
        lines: content.split("\n").length,
        bytes: Buffer.byteLength(content, "utf-8"),
        content,
        mtime: stat.mtime.toISOString(),
        source: "shared",
      });
    }
  } catch {
    // Directory unreadable
  }
  return files;
}

function isGitRepo(dir: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function getGitContributors(dir: string): string[] {
  try {
    const result = execSync("git log --format='%aN' --all | sort -u", {
      cwd: dir,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerSharedTools(server: McpServer): void {
  server.tool(
    "engram_team_config",
    "Get or set team configuration for shared memory. When called with no arguments, returns current config. When called with arguments, updates the config. Shared memory lets teams maintain a common set of memory files that all members can access.",
    {
      team_name: z.string().optional().describe("Team or organization name"),
      shared_memory_dir: z.string().optional().describe("Absolute path to shared memory directory (e.g., a git repo, Dropbox folder, or network drive)"),
      sync_mode: z
        .enum(["read-only", "read-write"])
        .optional()
        .describe("Whether this user can contribute to shared memory (read-only or read-write)"),
    },
    async ({ team_name, shared_memory_dir, sync_mode }) => {
      const existing = loadTeamConfig();

      // If no arguments, return current config
      if (!team_name && !shared_memory_dir && !sync_mode) {
        if (!existing) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    configured: false,
                    message: "No team config found. Use engram_team_config with team_name, shared_memory_dir, and sync_mode to set up shared memory.",
                    config_path: TEAM_CONFIG_PATH,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  configured: true,
                  config: existing,
                  config_path: TEAM_CONFIG_PATH,
                  shared_dir_exists: fs.existsSync(existing.shared_memory_dir),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Update config
      const updated: TeamConfig = {
        team_name: team_name || existing?.team_name || "My Team",
        shared_memory_dir: shared_memory_dir || existing?.shared_memory_dir || "",
        sync_mode: sync_mode || existing?.sync_mode || "read-only",
        last_synced: new Date().toISOString(),
      };

      if (!updated.shared_memory_dir) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "shared_memory_dir is required. Provide an absolute path to a directory where shared memory files will be stored.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      saveTeamConfig(updated);

      // Ensure shared dir exists if read-write
      if (updated.sync_mode === "read-write") {
        ensureDir(updated.shared_memory_dir);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                configured: true,
                config: updated,
                config_path: TEAM_CONFIG_PATH,
                shared_dir_exists: fs.existsSync(updated.shared_memory_dir),
                message: `Team config saved. Shared memory directory: ${updated.shared_memory_dir} (${updated.sync_mode})`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "engram_scan_shared",
    "Scan the shared memory directory and return files with effectiveness scores. Also provides a combined view showing personal + shared memories together. Requires team config to be set up first (see engram_team_config).",
    {
      memory_dir: z
        .string()
        .optional()
        .describe("Personal memory directory to include in combined view (optional)"),
    },
    async ({ memory_dir }) => {
      const config = loadTeamConfig();
      if (!config) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "No team config found. Run engram_team_config first to set up shared memory.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (!fs.existsSync(config.shared_memory_dir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: `Shared memory directory not found: ${config.shared_memory_dir}`,
                  hint: "Check that the path exists and is accessible. If using a git repo, make sure it is cloned.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const sharedFiles = scanSharedMemoryDir(config.shared_memory_dir);
      const sharedEffectiveness = calculateEffectivenessForFiles(sharedFiles);

      // Build combined view if personal memory_dir is provided
      let combined: CombinedMemoryView | null = null;
      if (memory_dir) {
        const project = scanProjectMemory(memory_dir, getProjectKey(memory_dir));
        const personalFiles = project ? project.files : [];
        combined = {
          personal: personalFiles,
          shared: sharedFiles,
          total: personalFiles.length + sharedFiles.length,
        };
      }

      // Update last_synced
      saveTeamConfig({ ...config, last_synced: new Date().toISOString() });

      const typeCounts: Record<string, number> = {};
      for (const f of sharedFiles) {
        typeCounts[f.type || "untyped"] = (typeCounts[f.type || "untyped"] || 0) + 1;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                team: config.team_name,
                shared_memory_dir: config.shared_memory_dir,
                sync_mode: config.sync_mode,
                shared: {
                  file_count: sharedFiles.length,
                  type_distribution: typeCounts,
                  files: sharedFiles.map((f) => ({
                    filename: f.filename,
                    name: f.name,
                    type: f.type,
                    description: f.description,
                    lines: f.lines,
                    bytes: f.bytes,
                    source: "shared",
                    last_modified: f.mtime,
                  })),
                  effectiveness: sharedEffectiveness,
                },
                combined: combined
                  ? {
                      personal_count: combined.personal.length,
                      shared_count: combined.shared.length,
                      total: combined.total,
                      all_files: [
                        ...combined.personal.map((f) => ({
                          filename: f.filename,
                          name: f.name,
                          type: f.type,
                          source: "personal" as const,
                        })),
                        ...combined.shared.map((f) => ({
                          filename: f.filename,
                          name: f.name,
                          type: f.type,
                          source: "shared" as const,
                        })),
                      ],
                    }
                  : null,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "engram_team_health",
    "Analyze team memory health. Reports on shared memory quality, contributor activity (if git repo), common gaps across the team, and type coverage. Helps identify what shared knowledge is missing or needs improvement.",
    {},
    async () => {
      const config = loadTeamConfig();
      if (!config) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: "No team config found. Run engram_team_config first.",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (!fs.existsSync(config.shared_memory_dir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: `Shared memory directory not found: ${config.shared_memory_dir}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const sharedFiles = scanSharedMemoryDir(config.shared_memory_dir);
      const sharedEffectiveness = calculateEffectivenessForFiles(sharedFiles);
      const gitRepo = isGitRepo(config.shared_memory_dir);

      // Analyze type coverage
      const presentTypes = new Set(sharedFiles.map((f) => f.type).filter((t) => t));
      const allTypes = ["user", "feedback", "project", "reference"];
      const missingTypes = allTypes.filter((t) => !presentTypes.has(t));

      // Identify common gaps
      const gaps: string[] = [];
      if (!presentTypes.has("feedback")) {
        gaps.push("No shared feedback/conventions memories — team may lack consistent coding standards");
      }
      if (!presentTypes.has("reference")) {
        gaps.push("No shared reference memories — team resources, links, and tools are not documented");
      }
      if (!presentTypes.has("project")) {
        gaps.push("No shared project memories — team goals and priorities are not captured");
      }
      if (sharedFiles.length === 0) {
        gaps.push("Shared memory directory is empty — no team knowledge is being shared");
      }

      const lowEffectiveness = sharedEffectiveness.filter((e) => e.score < 50);
      if (lowEffectiveness.length > 0) {
        gaps.push(
          `${lowEffectiveness.length} shared memory file(s) score below 50/100 effectiveness — review for quality`
        );
      }

      // Check for stale files
      const now = Date.now();
      const staleFiles = sharedFiles.filter((f) => {
        const ageDays = (now - new Date(f.mtime).getTime()) / (1000 * 60 * 60 * 24);
        return ageDays > 90;
      });
      if (staleFiles.length > 0) {
        gaps.push(
          `${staleFiles.length} shared file(s) not updated in 90+ days: ${staleFiles.map((f) => f.filename).join(", ")}`
        );
      }

      // Git contributor analysis
      const contributors: TeamContributor[] = [];
      if (gitRepo) {
        const gitContributors = getGitContributors(config.shared_memory_dir);
        for (const name of gitContributors) {
          // Try to find contributor's personal memory by looking for .claude directories
          // This is best-effort — only works if the shared repo contains contributor info
          try {
            const authorFiles = execSync(
              `git log --author="${name}" --name-only --pretty=format: --all -- "*.md"`,
              {
                cwd: config.shared_memory_dir,
                encoding: "utf-8",
                timeout: 10000,
                stdio: ["pipe", "pipe", "pipe"],
              }
            );
            const uniqueFiles = [
              ...new Set(
                authorFiles
                  .split("\n")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0 && s.endsWith(".md"))
              ),
            ];

            const typeCounts: Record<string, number> = {};
            for (const filename of uniqueFiles) {
              const filePath = path.join(config.shared_memory_dir, filename);
              if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, "utf-8");
                const fm = parseFrontmatter(content);
                const t = fm.type || "unknown";
                typeCounts[t] = (typeCounts[t] || 0) + 1;
              }
            }

            // Get last commit date for this contributor
            let lastUpdated = "";
            try {
              lastUpdated = execSync(
                `git log --author="${name}" -1 --format="%aI" --all`,
                {
                  cwd: config.shared_memory_dir,
                  encoding: "utf-8",
                  timeout: 5000,
                  stdio: ["pipe", "pipe", "pipe"],
                }
              ).trim();
            } catch {
              lastUpdated = "unknown";
            }

            const fileCount = uniqueFiles.length;
            let health: "good" | "needs-attention" | "minimal" = "good";
            if (fileCount === 0) health = "minimal";
            else if (fileCount < 2) health = "needs-attention";

            contributors.push({
              name,
              memory_dir: config.shared_memory_dir,
              file_count: fileCount,
              types: typeCounts,
              last_updated: lastUpdated,
              health,
            });
          } catch {
            contributors.push({
              name,
              memory_dir: config.shared_memory_dir,
              file_count: 0,
              types: {},
              last_updated: "unknown",
              health: "minimal",
            });
          }
        }
      }

      const report: TeamHealthReport = {
        team_name: config.team_name,
        shared_memory_dir: config.shared_memory_dir,
        is_git_repo: gitRepo,
        shared_files: sharedFiles.length,
        shared_effectiveness: sharedEffectiveness,
        contributors,
        common_gaps: gaps,
        coverage: {
          types_present: [...presentTypes],
          types_missing: missingTypes,
        },
      };

      // Compute overall health score
      const avgEffectiveness =
        sharedEffectiveness.length > 0
          ? Math.round(
              sharedEffectiveness.reduce((sum, e) => sum + e.score, 0) /
                sharedEffectiveness.length
            )
          : 0;

      const coverageScore = Math.round(
        ((allTypes.length - missingTypes.length) / allTypes.length) * 100
      );

      const overallHealth =
        sharedFiles.length === 0
          ? "empty"
          : avgEffectiveness >= 60 && gaps.length <= 1
            ? "healthy"
            : avgEffectiveness >= 40
              ? "needs-attention"
              : "unhealthy";

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ...report,
                summary: {
                  overall_health: overallHealth,
                  avg_effectiveness: avgEffectiveness,
                  type_coverage_pct: coverageScore,
                  gap_count: gaps.length,
                  contributor_count: contributors.length,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
