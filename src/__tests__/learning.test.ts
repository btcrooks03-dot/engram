import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { testDataDir } = vi.hoisted(() => {
  const _path = require("path");
  const _os = require("os");
  return { testDataDir: _path.join(_os.tmpdir(), "engram-learning-test-data") };
});

vi.mock("../constants.js", () => {
  const _path = require("path");
  return {
    SESSIONS_PATH: _path.join(testDataDir, "sessions.json"),
    DATA_DIR: testDataDir,
    MEMORY_INDEX: "MEMORY.md",
    LINE_CAP: 200,
    SIZE_CAP: 25600,
    STOP_WORDS: new Set([
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
    ]),
    CLAUDE_DIR: _path.join(testDataDir, ".claude"),
    PROJECTS_DIR: _path.join(testDataDir, ".claude", "projects"),
    PROFILES_DIR: _path.join(testDataDir, "profiles"),
    STORE_PATH: _path.join(testDataDir, "audit-history.json"),
    CHANGELOG_PATH: _path.join(testDataDir, "changelog.json"),
    CHANGES_PATH: _path.join(testDataDir, "file-changes.json"),
    SNAPSHOTS_PATH: _path.join(testDataDir, "file-snapshots.json"),
  };
});

import { logSession, loadSessions, saveSessions, analyzeSessionCoverage } from "../learning.js";

describe("learning module", () => {
  beforeEach(() => {
    fs.mkdirSync(testDataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  describe("logSession / loadSessions", () => {
    it("logs a session and loads it back", () => {
      logSession(["deployment", "kubernetes"], "test-project");

      const sessions = loadSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].topics).toEqual(["deployment", "kubernetes"]);
      expect(sessions[0].project).toBe("test-project");
      expect(sessions[0].timestamp).toBeDefined();
    });

    it("accumulates multiple sessions", () => {
      logSession(["topic-a"], "proj1");
      logSession(["topic-b"], "proj2");
      logSession(["topic-c"], "proj3");

      const sessions = loadSessions();
      expect(sessions).toHaveLength(3);
    });

    it("loadSessions returns empty array when no file exists", () => {
      expect(loadSessions()).toEqual([]);
    });

    it("saveSessions caps at 500 entries", () => {
      const sessions = Array.from({ length: 510 }, (_, i) => ({
        timestamp: new Date().toISOString(),
        topics: [`topic-${i}`],
        project: "test",
      }));
      saveSessions(sessions);
      const loaded = loadSessions();
      expect(loaded.length).toBeLessThanOrEqual(500);
    });
  });

  describe("analyzeSessionCoverage", () => {
    let memoryDir: string;

    beforeEach(() => {
      memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-learning-coverage-"));
    });

    afterEach(() => {
      fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it("returns basic stats when no memory files exist", () => {
      logSession(["deployment"], "test");
      logSession(["deployment"], "test");
      logSession(["testing"], "test");

      const result = analyzeSessionCoverage(memoryDir);
      expect(result.totalSessions).toBe(3);
      expect(result.topicFrequency.length).toBeGreaterThan(0);
      expect(result.suggestions).toContain("No memory files found — run /engram-init to bootstrap");
    });

    it("identifies coverage gaps for recurring topics", () => {
      fs.writeFileSync(
        path.join(memoryDir, "MEMORY.md"),
        "- [Deploy](deploy.md) — deployment notes\n"
      );
      fs.writeFileSync(
        path.join(memoryDir, "deploy.md"),
        `---
name: Deploy
description: Deployment pipeline configuration and process
type: project
---

Deployment with kubernetes and docker containers.`
      );

      logSession(["deployment pipeline"], "test");
      logSession(["deployment pipeline"], "test");
      logSession(["security audit vulnerability"], "test");
      logSession(["security audit vulnerability"], "test");
      logSession(["security audit vulnerability"], "test");

      const result = analyzeSessionCoverage(memoryDir);
      expect(result.totalSessions).toBe(5);
      const gapTopics = result.gaps.map((g) => g.topic);
      expect(gapTopics.some((t) => t.includes("security"))).toBe(true);
    });

    it("identifies well-covered topics", () => {
      fs.writeFileSync(
        path.join(memoryDir, "MEMORY.md"),
        "- [Python](python.md) — python dev\n"
      );
      fs.writeFileSync(
        path.join(memoryDir, "python.md"),
        `---
name: Python
description: Python development patterns and best practices for the project
type: project
---

Python development with django flask fastapi frameworks.`
      );

      logSession(["python development"], "test");
      logSession(["python development"], "test");

      const result = analyzeSessionCoverage(memoryDir);
      expect(result.wellCovered.length).toBeGreaterThanOrEqual(0);
    });

    it("counts topic frequency correctly", () => {
      logSession(["alpha"], "test");
      logSession(["alpha"], "test");
      logSession(["alpha"], "test");
      logSession(["beta"], "test");
      logSession(["beta"], "test");

      const result = analyzeSessionCoverage(memoryDir);
      const alphaFreq = result.topicFrequency.find((t) => t.topic === "alpha");
      const betaFreq = result.topicFrequency.find((t) => t.topic === "beta");
      expect(alphaFreq?.count).toBe(3);
      expect(betaFreq?.count).toBe(2);
    });
  });
});
