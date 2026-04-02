import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { STOP_WORDS, LINE_CAP } from "./constants.js";
import { parseFrontmatter } from "./helpers.js";
import { scanProjectMemory, getProjectKey } from "./scanning.js";
import { tokenize, jaccardSimilarity } from "./analysis.js";
export function generateSuggestions(project, projectDir) {
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
export function extractKeyPhrases(text) {
    const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
    const phrases = {};
    // Extract bigrams
    for (let i = 0; i < words.length - 1; i++) {
        const bigram = `${words[i]} ${words[i + 1]}`;
        phrases[bigram] = (phrases[bigram] || 0) + 1;
    }
    // Extract trigrams
    for (let i = 0; i < words.length - 2; i++) {
        const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
        phrases[trigram] = (phrases[trigram] || 0) + 1;
    }
    // Also include significant single words
    const wordFreq = {};
    for (const w of words)
        wordFreq[w] = (wordFreq[w] || 0) + 1;
    for (const [w, count] of Object.entries(wordFreq)) {
        if (count >= 2 || w.length >= 6)
            phrases[w] = count;
    }
    return Object.entries(phrases)
        .map(([phrase, count]) => ({
        phrase,
        // Score: frequency * word count bonus (prefer phrases over single words)
        score: count * (phrase.split(" ").length * 0.7 + 0.3),
    }))
        .sort((a, b) => b.score - a.score);
}
// Type-aware description templates
export const DESC_TEMPLATES = {
    user: (name, phrases) => `${name} — ${phrases.slice(0, 3).join(", ")}; tailor responses to this context`,
    feedback: (name, phrases) => `${name} — corrections/preferences: ${phrases.slice(0, 3).join(", ")}`,
    project: (name, phrases) => `${name} — ${phrases.slice(0, 3).join(", ")} project context and decisions`,
    reference: (name, phrases) => `${name} — pointers to ${phrases.slice(0, 3).join(", ")}`,
};
export function generateDescriptions(memoryDir) {
    const project = scanProjectMemory(memoryDir, getProjectKey(memoryDir));
    if (!project)
        return [];
    const suggestions = [];
    // Build corpus-wide frequencies for IDF
    const corpusFreq = {};
    const totalDocs = project.files.length;
    for (const file of project.files) {
        const uniqueWords = tokenize(file.content);
        for (const word of uniqueWords) {
            corpusFreq[word] = (corpusFreq[word] || 0) + 1;
        }
    }
    for (const file of project.files) {
        const needsImprovement = file.description.length < 30 ||
            /^(project|user|notes|info|data|config|settings|reference|feedback|details|context|misc)$/i.test(file.description.trim().split(/\s+/).slice(-1)[0] || "");
        if (!needsImprovement)
            continue;
        const body = file.content.replace(/^---[\s\S]*?---\n?/, "");
        // Extract key phrases (bigrams + trigrams + significant words)
        const rawPhrases = extractKeyPhrases(body);
        // Apply TF-IDF weighting to phrases
        const scoredPhrases = rawPhrases.map((p) => {
            const phraseWords = p.phrase.split(" ");
            const avgIdf = phraseWords.reduce((sum, w) => {
                return sum + Math.log((totalDocs + 1) / (corpusFreq[w] || 1));
            }, 0) / phraseWords.length;
            return { phrase: p.phrase, score: p.score * avgIdf };
        }).sort((a, b) => b.score - a.score);
        const topPhrases = scoredPhrases.slice(0, 5).map((p) => p.phrase);
        // Use type-aware template
        const template = DESC_TEMPLATES[file.type] || DESC_TEMPLATES.project;
        let suggested = template(file.name || "Untitled", topPhrases.length > 0 ? topPhrases : ["general context"]);
        // Trim to sweet spot (40-120 chars)
        if (suggested.length > 120)
            suggested = suggested.slice(0, 117) + "...";
        if (suggested.length < 30)
            suggested = `${file.name || "Untitled"} — ${file.type} memory for ${topPhrases[0] || "this project"}`;
        suggestions.push({
            file: file.filename,
            currentDescription: file.description,
            currentLength: file.description.length,
            suggestedDescription: suggested,
            suggestedLength: suggested.length,
            reason: file.description.length < 30
                ? `Current description is only ${file.description.length} chars — too short for effective relevance matching`
                : "Current description uses generic terms that won't match specific task queries",
        });
    }
    return suggestions;
}
export function generateMerge(memoryDir, file1, file2) {
    const path1 = path.join(memoryDir, file1);
    const path2 = path.join(memoryDir, file2);
    if (!fs.existsSync(path1))
        return `File not found: ${file1}`;
    if (!fs.existsSync(path2))
        return `File not found: ${file2}`;
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
    const normalizedSet = new Set();
    const mergedLines = [];
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
    const mergedDesc = (fm1.description || "").length >= (fm2.description || "").length
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
export function bootstrapScan(projectDir) {
    const suggestions = [];
    const projectInfo = { path: projectDir };
    // Detect language/framework
    const indicators = {
        python: ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile"],
        node: ["package.json", "node_modules"],
        rust: ["Cargo.toml"],
        go: ["go.mod"],
        java: ["pom.xml", "build.gradle"],
        ruby: ["Gemfile"],
        dotnet: ["*.csproj", "*.sln"],
    };
    const detectedLangs = [];
    for (const [lang, files] of Object.entries(indicators)) {
        for (const f of files) {
            if (f.includes("*")) {
                try {
                    const result = execSync(`find "${projectDir}" -maxdepth 2 -name "${f}" 2>/dev/null | head -1`, {
                        encoding: "utf-8",
                        timeout: 5000,
                    });
                    if (result.trim())
                        detectedLangs.push(lang);
                }
                catch { }
            }
            else if (fs.existsSync(path.join(projectDir, f))) {
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
            projectInfo.frameworks = Object.keys(deps).filter((d) => ["react", "vue", "angular", "next", "nuxt", "express", "fastify", "nest", "svelte"].includes(d));
            projectInfo.packageName = pkg.name;
        }
        catch { }
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
        if (remoteUrl)
            projectInfo.gitRemote = remoteUrl;
        const recentAuthors = execSync("git log --format='%aN' -20 2>/dev/null | sort | uniq -c | sort -rn | head -3", {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 5000,
        }).trim();
        if (recentAuthors)
            projectInfo.recentAuthors = recentAuthors;
    }
    catch { }
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
    }
    catch { }
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
