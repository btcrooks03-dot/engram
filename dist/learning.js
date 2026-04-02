import { SESSIONS_PATH } from "./constants.js";
import { readJson, writeJson } from "./helpers.js";
import { scanProjectMemory, getProjectKey } from "./scanning.js";
import { tokenize, jaccardSimilarity } from "./analysis.js";
export function loadSessions() {
    return readJson(SESSIONS_PATH) || [];
}
export function saveSessions(sessions) {
    while (sessions.length > 500)
        sessions.shift();
    writeJson(SESSIONS_PATH, sessions);
}
export function logSession(topics, project, memoryDir) {
    const sessions = loadSessions();
    sessions.push({
        timestamp: new Date().toISOString(),
        project,
        topics,
        memoryDir,
    });
    saveSessions(sessions);
}
export function analyzeSessionCoverage(memoryDir) {
    const sessions = loadSessions();
    const project = scanProjectMemory(memoryDir, getProjectKey(memoryDir));
    // Count topic frequency across all sessions
    const topicFreq = {};
    for (const session of sessions) {
        for (const topic of session.topics) {
            const normalized = topic.toLowerCase().trim();
            if (normalized.length >= 3) {
                topicFreq[normalized] = (topicFreq[normalized] || 0) + 1;
            }
        }
    }
    const sortedTopics = Object.entries(topicFreq)
        .sort(([, a], [, b]) => b - a)
        .map(([topic, count]) => ({ topic, count }));
    if (!project) {
        return {
            totalSessions: sessions.length,
            topicFrequency: sortedTopics.slice(0, 20),
            gaps: [],
            wellCovered: [],
            suggestions: ["No memory files found — run /engram-init to bootstrap"],
        };
    }
    // For each frequent topic, check if any memory covers it
    const gaps = [];
    const wellCovered = [];
    for (const { topic, count } of sortedTopics.slice(0, 30)) {
        if (count < 2)
            continue; // Only care about recurring topics
        const topicTokens = tokenize(topic);
        let bestMatch = "";
        let bestScore = 0;
        for (const file of project.files) {
            const descTokens = tokenize(file.description);
            const contentTokens = tokenize(file.content);
            const descSim = jaccardSimilarity(topicTokens, descTokens);
            const contentSim = jaccardSimilarity(topicTokens, contentTokens);
            const score = descSim * 0.6 + contentSim * 0.4;
            if (score > bestScore) {
                bestScore = score;
                bestMatch = file.filename;
            }
        }
        const covered = bestScore > 0.15;
        if (covered) {
            wellCovered.push(topic);
        }
        else {
            gaps.push({ topic, frequency: count, bestMemoryMatch: bestMatch, bestScore: Math.round(bestScore * 1000) / 1000, covered });
        }
    }
    // Generate suggestions from gaps
    const suggestions = [];
    const topGaps = gaps.sort((a, b) => b.frequency - a.frequency).slice(0, 5);
    for (const gap of topGaps) {
        suggestions.push(`Topic "${gap.topic}" came up ${gap.frequency} times but no memory covers it well (best match: ${gap.bestMemoryMatch || "none"} at ${Math.round(gap.bestScore * 100)}%)`);
    }
    if (gaps.length === 0 && sessions.length >= 5) {
        suggestions.push("Good coverage — all recurring topics are represented in memory");
    }
    return {
        totalSessions: sessions.length,
        topicFrequency: sortedTopics.slice(0, 20),
        gaps: topGaps,
        wellCovered,
        suggestions,
    };
}
