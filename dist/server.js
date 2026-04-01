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
// ─── Helpers ─────────────────────────────────────────────────────────────────
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
function readJson(filepath) {
    try {
        return JSON.parse(fs.readFileSync(filepath, "utf-8"));
    }
    catch {
        return null;
    }
}
function writeJson(filepath, data) {
    ensureDir(path.dirname(filepath));
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}
function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match)
        return {};
    const fm = {};
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
function extractLinks(indexContent) {
    const links = [];
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(indexContent)) !== null) {
        links.push({ title: m[1], file: m[2] });
    }
    return links;
}
function scanProjectMemory(memoryDir, projectName) {
    const indexPath = path.join(memoryDir, MEMORY_INDEX);
    if (!fs.existsSync(indexPath))
        return null;
    const indexContent = fs.readFileSync(indexPath, "utf-8");
    const indexLines = indexContent.split("\n").length;
    const indexBytes = Buffer.byteLength(indexContent, "utf-8");
    const links = extractLinks(indexContent);
    const linkedFiles = new Set(links.map((l) => l.file));
    // Read linked memory files
    const files = [];
    const deadLinks = [];
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
    const orphans = [];
    try {
        const allMd = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md") && f !== MEMORY_INDEX);
        for (const f of allMd) {
            if (!linkedFiles.has(f))
                orphans.push(f);
        }
    }
    catch { }
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
function tokenize(text) {
    // Remove frontmatter, then extract words
    const body = text.replace(/^---[\s\S]*?---\n?/, "");
    const words = body
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2);
    return new Set(words);
}
function jaccardSimilarity(a, b) {
    const intersection = new Set([...a].filter((x) => b.has(x)));
    const union = new Set([...a, ...b]);
    if (union.size === 0)
        return 0;
    return intersection.size / union.size;
}
function analyzeDuplicates(files) {
    const pairs = [];
    const tokenSets = files.map((f) => ({ file: f.filename, tokens: tokenize(f.content) }));
    for (let i = 0; i < tokenSets.length; i++) {
        for (let j = i + 1; j < tokenSets.length; j++) {
            const sim = jaccardSimilarity(tokenSets[i].tokens, tokenSets[j].tokens);
            if (sim > 0.25) {
                // Find shared significant words
                const shared = [...tokenSets[i].tokens].filter((w) => tokenSets[j].tokens.has(w));
                // Filter to longer, more meaningful words
                const topics = shared.filter((w) => w.length > 4).slice(0, 10);
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
function gitMemoryLog(memoryDir, limit = 20) {
    try {
        // Check if directory is in a git repo
        const gitRoot = execSync("git rev-parse --show-toplevel", {
            cwd: memoryDir,
            encoding: "utf-8",
            timeout: 5000,
        }).trim();
        const relPath = path.relative(gitRoot, memoryDir);
        const log = execSync(`git log --oneline --diff-filter=ACDMR --name-status -n ${limit} -- "${relPath}"`, { cwd: gitRoot, encoding: "utf-8", timeout: 10000 });
        return log
            .split("\n")
            .filter((l) => l.trim().length > 0);
    }
    catch {
        return ["(not in a git repository or no history)"];
    }
}
function gitMemoryDiff(memoryDir, since) {
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
    }
    catch {
        return "(not in a git repository)";
    }
}
function generateSuggestions(project, projectDir) {
    const suggestions = [];
    const existingTypes = new Set(project.files.map((f) => f.type));
    const existingContent = project.files.map((f) => f.content.toLowerCase()).join("\n");
    // Check type coverage
    if (!existingTypes.has("feedback")) {
        suggestions.push({
            type: "missing_feedback",
            title: "No feedback memories found",
            detail: "Feedback memories capture corrections and confirmations from the user. Without them, Claude may repeat mistakes or drift from validated approaches across conversations.",
            priority: "high",
        });
    }
    if (!existingTypes.has("reference")) {
        suggestions.push({
            type: "missing_reference",
            title: "No reference memories found",
            detail: "Reference memories point to external resources (dashboards, issue trackers, docs). They help Claude find information without the user having to re-explain where things are.",
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
            const words = commitMessages
                .join(" ")
                .toLowerCase()
                .split(/\s+/)
                .filter((w) => w.length > 5);
            const freq = {};
            for (const w of words)
                freq[w] = (freq[w] || 0) + 1;
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
        }
        catch { }
    }
    return suggestions;
}
function scanClaudeMd(projectDir) {
    const files = [];
    const issues = [];
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
            const findResult = execSync(`find "${projectDir}" -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/.git/*" -maxdepth 4 2>/dev/null || true`, { encoding: "utf-8", timeout: 10000 });
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
        }
        catch { }
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
function listProfiles(memoryDir) {
    const projectKey = path.basename(path.dirname(memoryDir));
    const profileDir = path.join(PROFILES_DIR, projectKey);
    if (!fs.existsSync(profileDir))
        return [];
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
function saveProfile(memoryDir, profileName) {
    const projectKey = path.basename(path.dirname(memoryDir));
    const profileDir = path.join(PROFILES_DIR, projectKey, profileName);
    if (fs.existsSync(profileDir)) {
        // Overwrite existing
        fs.rmSync(profileDir, { recursive: true });
    }
    ensureDir(profileDir);
    // Copy all .md files from memory dir to profile dir
    const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
    let copied = 0;
    for (const file of files) {
        fs.copyFileSync(path.join(memoryDir, file), path.join(profileDir, file));
        copied++;
    }
    return `Profile "${profileName}" saved with ${copied} files to ${profileDir}`;
}
function loadProfile(memoryDir, profileName) {
    const projectKey = path.basename(path.dirname(memoryDir));
    const profileDir = path.join(PROFILES_DIR, projectKey, profileName);
    if (!fs.existsSync(profileDir)) {
        return `Profile "${profileName}" not found. Use engram_profile_list to see available profiles.`;
    }
    // Backup current as "_previous"
    saveProfile(memoryDir, "_previous_auto_backup");
    // Clear current memory files (except MEMORY.md backup)
    const currentFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
    for (const file of currentFiles) {
        fs.unlinkSync(path.join(memoryDir, file));
    }
    // Copy profile files to memory dir
    const profileFiles = fs.readdirSync(profileDir).filter((f) => f.endsWith(".md"));
    let restored = 0;
    for (const file of profileFiles) {
        fs.copyFileSync(path.join(profileDir, file), path.join(memoryDir, file));
        restored++;
    }
    return `Profile "${profileName}" loaded (${restored} files). Previous state backed up as "_previous_auto_backup".`;
}
function loadHistory() {
    return readJson(STORE_PATH) || [];
}
function saveAuditRecord(record) {
    const history = loadHistory();
    history.push(record);
    // Keep last 100 records
    while (history.length > 100)
        history.shift();
    writeJson(STORE_PATH, history);
}
const CHANGES_PATH = path.join(DATA_DIR, "file-changes.json");
function loadChanges() {
    return readJson(CHANGES_PATH) || [];
}
function saveChanges(changes) {
    // Keep last 200 entries
    while (changes.length > 200)
        changes.shift();
    writeJson(CHANGES_PATH, changes);
}
const SNAPSHOTS_PATH = path.join(DATA_DIR, "file-snapshots.json");
function detectChanges(memoryDir) {
    const snapshots = readJson(SNAPSHOTS_PATH) || {};
    const newSnapshots = {};
    const changes = [];
    const now = new Date().toISOString();
    try {
        const currentFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
        for (const file of currentFiles) {
            const fullPath = path.join(memoryDir, file);
            const stat = fs.statSync(fullPath);
            const key = fullPath;
            newSnapshots[key] = { size: stat.size, mtime: stat.mtimeMs };
            if (!snapshots[key]) {
                changes.push({ file, type: "added", timestamp: now, sizeDelta: stat.size });
            }
            else if (snapshots[key].mtime !== stat.mtimeMs) {
                changes.push({
                    file,
                    type: "modified",
                    timestamp: now,
                    sizeDelta: stat.size - snapshots[key].size,
                });
            }
        }
        // Check for deleted files
        for (const key of Object.keys(snapshots)) {
            if (key.startsWith(memoryDir) && !newSnapshots[key]) {
                const file = path.basename(key);
                changes.push({ file, type: "deleted", timestamp: now, sizeDelta: -snapshots[key].size });
            }
        }
    }
    catch { }
    // Update snapshots
    writeJson(SNAPSHOTS_PATH, newSnapshots);
    // Append to change history
    if (changes.length > 0) {
        const history = loadChanges();
        history.push(...changes);
        saveChanges(history);
    }
    return changes;
}
// ═══════════════════════════════════════════════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════════════════════════════════════════════
const server = new McpServer({
    name: "engram",
    version: "2.0.0",
});
// ─── Tool: Scan All Projects ─────────────────────────────────────────────────
server.tool("engram_scan_all_projects", "Scan memory across ALL Claude Code projects. Returns unified view of every project's memory: files, caps, orphans, dead links. Use this for cross-project duplicate detection and global memory health.", {}, async () => {
    const results = [];
    if (fs.existsSync(PROJECTS_DIR)) {
        for (const projectKey of fs.readdirSync(PROJECTS_DIR)) {
            const memoryDir = path.join(PROJECTS_DIR, projectKey, "memory");
            if (fs.existsSync(memoryDir)) {
                const result = scanProjectMemory(memoryDir, projectKey);
                if (result)
                    results.push(result);
            }
        }
    }
    // Also detect cross-project duplicates
    const allFiles = [];
    for (const proj of results) {
        for (const f of proj.files) {
            allFiles.push({ ...f, project: proj.project });
        }
    }
    const crossDupes = [];
    for (let i = 0; i < allFiles.length; i++) {
        for (let j = i + 1; j < allFiles.length; j++) {
            if (allFiles[i].project === allFiles[j].project)
                continue;
            const sim = jaccardSimilarity(tokenize(allFiles[i].content), tokenize(allFiles[j].content));
            if (sim > 0.3) {
                crossDupes.push({
                    file1: allFiles[i].filename,
                    project1: allFiles[i].project,
                    file2: allFiles[j].filename,
                    project2: allFiles[j].project,
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
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
});
// ─── Tool: Analyze Duplicates ────────────────────────────────────────────────
server.tool("engram_analyze_duplicates", "Rigorous duplicate and overlap detection using Jaccard similarity on tokenized content. Returns similarity scores for all memory file pairs above threshold. More reliable than subjective comparison.", { memory_dir: z.string().describe("Path to the memory directory containing .md files") }, async ({ memory_dir }) => {
    const project = scanProjectMemory(memory_dir, path.basename(path.dirname(memory_dir)));
    if (!project)
        return { content: [{ type: "text", text: "No MEMORY.md found in " + memory_dir }] };
    const duplicates = analyzeDuplicates(project.files);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    totalFiles: project.files.length,
                    pairsAnalyzed: (project.files.length * (project.files.length - 1)) / 2,
                    duplicatesFound: duplicates.length,
                    pairs: duplicates.map((d) => ({
                        ...d,
                        recommendation: d.similarity > 0.6
                            ? "MERGE — high overlap, likely redundant"
                            : d.similarity > 0.4
                                ? "REVIEW — moderate overlap, may benefit from dedup"
                                : "MONITOR — some shared topics but likely distinct",
                    })),
                }, null, 2),
            },
        ],
    };
});
// ─── Tool: Save Audit ────────────────────────────────────────────────────────
server.tool("engram_save_audit", "Persist an audit result to history. Call this after running /engram to track health score, cap usage, and issue counts over time.", {
    project: z.string().describe("Project identifier"),
    score: z.number().describe("Health score 0-100"),
    issues_count: z.number().describe("Number of issues found"),
    line_usage: z.number().describe("MEMORY.md line count"),
    size_usage: z.number().describe("MEMORY.md byte size"),
    file_count: z.number().describe("Number of memory files"),
    details: z.string().optional().describe("Optional details or notes"),
}, async ({ project, score, issues_count, line_usage, size_usage, file_count, details }) => {
    const record = {
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
    return { content: [{ type: "text", text: `Audit saved. Total records: ${loadHistory().length}` }] };
});
// ─── Tool: Get History ───────────────────────────────────────────────────────
server.tool("engram_get_history", "Retrieve audit history to see health score trends, cap usage over time, and whether optimizations helped.", {
    project: z.string().optional().describe("Filter by project (optional)"),
    limit: z.number().optional().describe("Number of records to return (default 10)"),
}, async ({ project, limit }) => {
    let history = loadHistory();
    if (project)
        history = history.filter((r) => r.project === project);
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
                type: "text",
                text: JSON.stringify({ totalRecords: history.length, trend, records: recent }, null, 2),
            },
        ],
    };
});
// ─── Tool: Suggest Memories ──────────────────────────────────────────────────
server.tool("engram_suggest_memories", "Generative suggestions — analyzes existing memory gaps, type coverage, description quality, git patterns, and staleness to suggest what SHOULD be in memory. The flip side of /engram-optimize.", {
    memory_dir: z.string().describe("Path to the memory directory"),
    project_dir: z.string().optional().describe("Path to the project root (for git analysis)"),
}, async ({ memory_dir, project_dir }) => {
    const project = scanProjectMemory(memory_dir, path.basename(path.dirname(memory_dir)));
    if (!project)
        return { content: [{ type: "text", text: "No MEMORY.md found" }] };
    const suggestions = generateSuggestions(project, project_dir);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    totalSuggestions: suggestions.length,
                    byPriority: {
                        high: suggestions.filter((s) => s.priority === "high").length,
                        medium: suggestions.filter((s) => s.priority === "medium").length,
                        low: suggestions.filter((s) => s.priority === "low").length,
                    },
                    suggestions,
                }, null, 2),
            },
        ],
    };
});
// ─── Tool: CLAUDE.md Audit ───────────────────────────────────────────────────
server.tool("engram_scan_claudemd", "Audit all CLAUDE.md files — global, project, and directory-level. Detects bloat, stale markers, generic instructions, and missing files. Also cross-references with memory for overlap.", {
    project_dir: z.string().optional().describe("Project root directory to scan"),
}, async ({ project_dir }) => {
    const result = scanClaudeMd(project_dir);
    // Cross-reference with memory if we can find it
    if (project_dir) {
        // Try to find the memory dir for this project
        const projectKey = project_dir.replace(/\//g, "-");
        const possibleMemoryDir = path.join(PROJECTS_DIR, projectKey, "memory");
        if (fs.existsSync(possibleMemoryDir)) {
            const project = scanProjectMemory(possibleMemoryDir, projectKey);
            if (project) {
                // Check for overlap between CLAUDE.md content and memory content
                for (const claudeFile of result.files) {
                    for (const memFile of project.files) {
                        const sim = jaccardSimilarity(tokenize(claudeFile.content), tokenize(memFile.content));
                        if (sim > 0.25) {
                            result.issues.push({
                                file: claudeFile.path,
                                type: "overlap_with_memory",
                                detail: `Significant overlap (${Math.round(sim * 100)}%) with memory file "${memFile.filename}". CLAUDE.md and memory serve different purposes — CLAUDE.md for deterministic instructions, memory for contextual recall. Deduplicate.`,
                                severity: sim > 0.4 ? "high" : "medium",
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
                type: "text",
                text: JSON.stringify({
                    filesFound: result.files.length,
                    files: result.files.map((f) => ({
                        path: f.path,
                        scope: f.scope,
                        lines: f.lines,
                        bytes: f.bytes,
                    })),
                    issuesFound: result.issues.length,
                    issues: result.issues,
                }, null, 2),
            },
        ],
    };
});
// ─── Tool: Profile List ──────────────────────────────────────────────────────
server.tool("engram_profile_list", "List saved memory profiles for a project. Profiles are named snapshots of memory state that can be swapped for different workflows.", { memory_dir: z.string().describe("Path to the memory directory") }, async ({ memory_dir }) => {
    const profiles = listProfiles(memory_dir);
    return { content: [{ type: "text", text: JSON.stringify({ profiles }, null, 2) }] };
});
// ─── Tool: Profile Save ─────────────────────────────────────────────────────
server.tool("engram_profile_save", "Snapshot current memory state as a named profile. Use before switching workflows (e.g., save 'debugging' profile before switching to 'feature-work').", {
    memory_dir: z.string().describe("Path to the memory directory"),
    profile_name: z.string().describe("Name for the profile (e.g., 'debugging', 'feature-work', 'refactoring')"),
}, async ({ memory_dir, profile_name }) => {
    const result = saveProfile(memory_dir, profile_name);
    return { content: [{ type: "text", text: result }] };
});
// ─── Tool: Profile Load ─────────────────────────────────────────────────────
server.tool("engram_profile_load", "Restore a saved memory profile, replacing current memory state. Automatically backs up current state first.", {
    memory_dir: z.string().describe("Path to the memory directory"),
    profile_name: z.string().describe("Name of the profile to load"),
}, async ({ memory_dir, profile_name }) => {
    const result = loadProfile(memory_dir, profile_name);
    return { content: [{ type: "text", text: result }] };
});
// ─── Tool: Git Memory Log ────────────────────────────────────────────────────
server.tool("engram_memory_git_log", "Track memory file changes via git history — when entries were added, modified, or deleted. Shows memory drift over time.", {
    memory_dir: z.string().describe("Path to the memory directory"),
    limit: z.number().optional().describe("Number of git log entries (default 20)"),
    since: z.string().optional().describe("Show changes since date (e.g., '7 days ago', '2024-01-01')"),
}, async ({ memory_dir, limit, since }) => {
    const log = gitMemoryLog(memory_dir, limit || 20);
    const diff = since ? gitMemoryDiff(memory_dir, since) : gitMemoryDiff(memory_dir);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    gitLog: log,
                    recentChanges: diff,
                }, null, 2),
            },
        ],
    };
});
// ─── Tool: Watch Status ──────────────────────────────────────────────────────
server.tool("engram_watch_status", "Check for memory file changes since last check. Compares file mtimes and sizes against last snapshot. Reports additions, modifications, deletions, and cap warnings.", {
    memory_dir: z.string().describe("Path to the memory directory"),
}, async ({ memory_dir }) => {
    const changes = detectChanges(memory_dir);
    const history = loadChanges();
    // Check current cap status
    const indexPath = path.join(memory_dir, MEMORY_INDEX);
    let capWarning = null;
    if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, "utf-8");
        const lines = content.split("\n").length;
        const bytes = Buffer.byteLength(content, "utf-8");
        if (lines > LINE_CAP)
            capWarning = `CRITICAL: ${lines}/${LINE_CAP} lines — content is being truncated!`;
        else if (lines > 150)
            capWarning = `WARNING: ${lines}/${LINE_CAP} lines — approaching cap`;
        if (bytes > SIZE_CAP)
            capWarning = (capWarning ? capWarning + " | " : "") + `CRITICAL: ${bytes}/${SIZE_CAP} bytes — over size cap!`;
        else if (bytes > 20480)
            capWarning = (capWarning ? capWarning + " | " : "") + `WARNING: ${bytes}/${SIZE_CAP} bytes — approaching size cap`;
    }
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    currentChanges: changes,
                    recentHistory: history.slice(-20),
                    capWarning,
                }, null, 2),
            },
        ],
    };
});
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
