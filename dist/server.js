import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { PROJECTS_DIR, DATA_DIR, MEMORY_INDEX, LINE_CAP, SIZE_CAP } from "./constants.js";
import { ensureDir } from "./helpers.js";
import { scanProjectMemory, scanClaudeMd } from "./scanning.js";
import { tokenize, jaccardSimilarity, analyzeDuplicates, simulateRelevance, calculateEffectiveness } from "./analysis.js";
import { generateSuggestions, generateDescriptions, generateMerge, bootstrapScan } from "./generation.js";
import { listProfiles, saveProfile, loadProfile, deleteProfile, diffProfile } from "./profiles.js";
import { loadHistory, saveAuditRecord, loadChanges, detectChanges, detectDerivableContent, logOperation, getChangelog } from "./history.js";
import { loadSessions, logSession, analyzeSessionCoverage } from "./learning.js";
import { gitMemoryLog, gitMemoryDiff } from "./git.js";
import { registerTemplateTools } from "./templates.js";
import { registerSharedTools } from "./shared.js";
// ═══════════════════════════════════════════════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════════════════════════════════════════════
const server = new McpServer({
    name: "engram",
    version: "4.0.0",
});
// Register template and shared memory tools
registerTemplateTools(server);
registerSharedTools(server);
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
    // Precompute token sets to avoid O(n^2) tokenize calls
    const tokenCache = allFiles.map((f) => ({ ...f, tokens: tokenize(f.content) }));
    const crossDupes = [];
    for (let i = 0; i < tokenCache.length; i++) {
        for (let j = i + 1; j < tokenCache.length; j++) {
            if (tokenCache[i].project === tokenCache[j].project)
                continue;
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
// ─── Tool: Profile Delete ────────────────────────────────────────────────────
server.tool("engram_profile_delete", "Delete a saved memory profile permanently.", {
    memory_dir: z.string().describe("Path to the memory directory"),
    profile_name: z.string().describe("Name of the profile to delete"),
}, async ({ memory_dir, profile_name }) => {
    const result = deleteProfile(memory_dir, profile_name);
    return { content: [{ type: "text", text: result }] };
});
// ─── Tool: Profile Diff ─────────────────────────────────────────────────────
server.tool("engram_profile_diff", "Compare current memory state with a saved profile. Shows files only in current, only in profile, and files in both with change status.", {
    memory_dir: z.string().describe("Path to the memory directory"),
    profile_name: z.string().describe("Name of the profile to compare against"),
}, async ({ memory_dir, profile_name }) => {
    const diff = diffProfile(memory_dir, profile_name);
    return { content: [{ type: "text", text: JSON.stringify(diff, null, 2) }] };
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
// ─── Tool: Detect Derivable Content ──────────────────────────────────────────
server.tool("engram_detect_derivable", "Deterministic derivable content detection — scans memory files for file paths, CLI commands, function names, and config values, then checks if they exist in the project codebase. Returns computed results, not LLM guesses.", {
    memory_dir: z.string().describe("Path to the memory directory"),
    project_dir: z.string().optional().describe("Path to the project root (for codebase scanning)"),
}, async ({ memory_dir, project_dir }) => {
    const items = detectDerivableContent(memory_dir, project_dir);
    const byType = {
        file_paths: items.filter((i) => i.type === "file_path").length,
        cli_commands: items.filter((i) => i.type === "cli_command").length,
        function_names: items.filter((i) => i.type === "function_name").length,
        config_values: items.filter((i) => i.type === "config_value").length,
    };
    return {
        content: [{
                type: "text",
                text: JSON.stringify({ totalFound: items.length, byType, items }, null, 2),
            }],
    };
});
// ─── Tool: Simulate Relevance ────────────────────────────────────────────────
server.tool("engram_simulate_relevance", "Simulate which memories would be selected for a given task. Scores each memory's description and content against the task description, ranked by likely relevance. Shows the predicted top 5.", {
    task_description: z.string().describe("Description of the task or conversation topic to simulate"),
    memory_dir: z.string().describe("Path to the memory directory"),
}, async ({ task_description, memory_dir }) => {
    const scores = simulateRelevance(task_description, memory_dir);
    const top5 = scores.slice(0, 5);
    const rest = scores.slice(5);
    // Also log this as a session topic for pattern learning
    logSession([task_description], undefined, memory_dir);
    // Overall confidence assessment
    const highConfCount = top5.filter((s) => s.confidence === "high").length;
    const overallConfidence = highConfCount >= 3 ? "high — strong matches found" :
        highConfCount >= 1 ? "medium — some good matches, some uncertain" :
            "low — weak matches, descriptions may need improvement";
    return {
        content: [{
                type: "text",
                text: JSON.stringify({
                    taskDescription: task_description,
                    overallConfidence,
                    predictedSelection: top5.map((s, i) => ({ rank: i + 1, ...s })),
                    notSelected: rest.map((s) => ({
                        file: s.file, score: s.score, confidence: s.confidence, description: s.description,
                    })),
                    note: "Scores combine unigram, bigram, and phrase matching weighted 60% description / 30% content / 10% type. Confidence indicates match strength. This task has been logged for pattern learning.",
                }, null, 2),
            }],
    };
});
// ─── Tool: Generate Descriptions ─────────────────────────────────────────────
server.tool("engram_generate_descriptions", "Generate improved descriptions for memory files with weak or generic descriptions. Uses TF-IDF-like scoring to extract distinctive terms. Returns ready-to-apply replacements.", { memory_dir: z.string().describe("Path to the memory directory") }, async ({ memory_dir }) => {
    const suggestions = generateDescriptions(memory_dir);
    return {
        content: [{
                type: "text",
                text: JSON.stringify({
                    totalSuggestions: suggestions.length,
                    suggestions,
                }, null, 2),
            }],
    };
});
// ─── Tool: Generate Merge ────────────────────────────────────────────────────
server.tool("engram_generate_merge", "Generate a deduplicated merge of two memory files. Combines frontmatter, removes duplicate lines, preserves unique content from both. Returns the merged content ready to write.", {
    memory_dir: z.string().describe("Path to the memory directory"),
    file1: z.string().describe("First filename (e.g., 'project_notes.md')"),
    file2: z.string().describe("Second filename (e.g., 'project_context.md')"),
}, async ({ memory_dir, file1, file2 }) => {
    const result = generateMerge(memory_dir, file1, file2);
    if (typeof result === "string") {
        return { content: [{ type: "text", text: result }] };
    }
    logOperation("merge_generated", [file1, file2], `Similarity: ${result.similarity}, lines saved: ${result.linesSaved}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});
// ─── Tool: Effectiveness Scores ──────────────────────────────────────────────
server.tool("engram_effectiveness", "Per-file effectiveness scoring (0-100) based on description quality, freshness, uniqueness, density, and type appropriateness. Identifies which memories are pulling their weight and which are dead weight.", { memory_dir: z.string().describe("Path to the memory directory") }, async ({ memory_dir }) => {
    const scores = calculateEffectiveness(memory_dir);
    const avg = scores.length > 0 ? Math.round(scores.reduce((s, e) => s + e.score, 0) / scores.length) : 0;
    return {
        content: [{
                type: "text",
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
});
// ─── Tool: Log Operation ─────────────────────────────────────────────────────
server.tool("engram_log_operation", "Log a memory operation to the changelog. Call this after any memory modification (create, edit, delete, merge, profile switch).", {
    operation: z.string().describe("Operation type (create, edit, delete, merge, optimize, profile_switch, profile_save)"),
    files: z.array(z.string()).describe("Files affected"),
    details: z.string().describe("Brief description of what changed"),
}, async ({ operation, files, details }) => {
    logOperation(operation, files, details);
    return { content: [{ type: "text", text: `Logged: ${operation} on ${files.join(", ")}` }] };
});
// ─── Tool: Get Changelog ─────────────────────────────────────────────────────
server.tool("engram_get_changelog", "Retrieve the memory changelog — a history of all memory operations (creates, edits, deletes, merges, profile switches) with timestamps.", { limit: z.number().optional().describe("Number of entries to return (default 20)") }, async ({ limit }) => {
    const entries = getChangelog(limit || 20);
    return { content: [{ type: "text", text: JSON.stringify({ entries, totalEntries: entries.length }, null, 2) }] };
});
// ─── Tool: Bootstrap Scan ────────────────────────────────────────────────────
server.tool("engram_bootstrap", "Scan a project directory and suggest starter memory files. Detects language, framework, git info, and directory structure. Returns structured suggestions for user, feedback, project, and reference memories.", { project_dir: z.string().describe("Path to the project root directory") }, async ({ project_dir }) => {
    if (!fs.existsSync(project_dir)) {
        return { content: [{ type: "text", text: `Directory not found: ${project_dir}` }] };
    }
    const result = bootstrapScan(project_dir);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});
// ─── Tool: Log Session Topics ────────────────────────────────────────────────
server.tool("engram_log_session", "Log conversation topics for pattern learning. Call this during or after conversations to build a dataset of what topics come up. Over time, engram uses this to identify memory gaps — topics that recur but aren't covered by any memory.", {
    topics: z.array(z.string()).describe("List of topics/themes from this conversation (e.g., ['auth flow debugging', 'database migration', 'API rate limiting'])"),
    project: z.string().optional().describe("Project identifier"),
    memory_dir: z.string().optional().describe("Path to the memory directory"),
}, async ({ topics, project, memory_dir }) => {
    logSession(topics, project, memory_dir);
    const sessions = loadSessions();
    return {
        content: [{
                type: "text",
                text: `Logged ${topics.length} topics. Total sessions recorded: ${sessions.length}`,
            }],
    };
});
// ─── Tool: Analyze Session Coverage ──────────────────────────────────────────
server.tool("engram_session_coverage", "Analyze conversation pattern coverage — which recurring topics are well-covered by memory and which are gaps. Requires session data from engram_log_session. More sessions = better analysis.", { memory_dir: z.string().describe("Path to the memory directory") }, async ({ memory_dir }) => {
    const analysis = analyzeSessionCoverage(memory_dir);
    return {
        content: [{
                type: "text",
                text: JSON.stringify(analysis, null, 2),
            }],
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
