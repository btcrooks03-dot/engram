import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// vi.hoisted runs before imports, so we must use require-style for path/os
const { testDataDir } = vi.hoisted(() => {
  const _path = require("path");
  const _os = require("os");
  return { testDataDir: _path.join(_os.tmpdir(), "engram-history-test-data") };
});

vi.mock("../constants.js", () => {
  const _path = require("path");
  return {
    STORE_PATH: _path.join(testDataDir, "audit-history.json"),
    CHANGELOG_PATH: _path.join(testDataDir, "changelog.json"),
    CHANGES_PATH: _path.join(testDataDir, "file-changes.json"),
    SNAPSHOTS_PATH: _path.join(testDataDir, "file-snapshots.json"),
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
    SESSIONS_PATH: _path.join(testDataDir, "sessions.json"),
  };
});

import { saveAuditRecord, loadHistory, logOperation, getChangelog, detectChanges, loadChanges } from "../history.js";
import type { AuditRecord } from "../types.js";

describe("history module", () => {
  beforeEach(() => {
    fs.mkdirSync(testDataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  describe("saveAuditRecord / loadHistory", () => {
    it("saves and loads audit records", () => {
      const record: AuditRecord = {
        timestamp: new Date().toISOString(),
        project: "test-project",
        score: 85,
        issueCount: 2,
        lineUsage: 50,
        sizeUsage: 30,
        fileCount: 5,
        details: "Test audit",
      };

      saveAuditRecord(record);
      const history = loadHistory();
      expect(history).toHaveLength(1);
      expect(history[0].project).toBe("test-project");
      expect(history[0].score).toBe(85);
    });

    it("appends multiple records", () => {
      for (let i = 0; i < 3; i++) {
        saveAuditRecord({
          timestamp: new Date().toISOString(),
          project: `project-${i}`,
          score: 50 + i * 10,
          issueCount: i,
          lineUsage: 10,
          sizeUsage: 10,
          fileCount: i + 1,
        });
      }
      const history = loadHistory();
      expect(history).toHaveLength(3);
    });

    it("keeps at most 100 records", () => {
      for (let i = 0; i < 105; i++) {
        saveAuditRecord({
          timestamp: new Date().toISOString(),
          project: `project-${i}`,
          score: 50,
          issueCount: 0,
          lineUsage: 10,
          sizeUsage: 10,
          fileCount: 1,
        });
      }
      const history = loadHistory();
      expect(history.length).toBeLessThanOrEqual(100);
    });

    it("loadHistory returns empty array when no file exists", () => {
      const history = loadHistory();
      expect(history).toEqual([]);
    });
  });

  describe("logOperation / getChangelog", () => {
    it("logs operations and retrieves them", () => {
      logOperation("scan", ["MEMORY.md"], "Scanned memory directory");
      logOperation("merge", ["a.md", "b.md"], "Merged two files");

      const changelog = getChangelog();
      expect(changelog).toHaveLength(2);
      expect(changelog[0].operation).toBe("scan");
      expect(changelog[1].operation).toBe("merge");
      expect(changelog[1].files).toEqual(["a.md", "b.md"]);
    });

    it("getChangelog respects limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        logOperation("op", [`file-${i}.md`], `Operation ${i}`);
      }
      const limited = getChangelog(3);
      expect(limited).toHaveLength(3);
    });

    it("getChangelog returns empty array when no log exists", () => {
      expect(getChangelog()).toEqual([]);
    });
  });

  describe("detectChanges", () => {
    let memoryDir: string;

    beforeEach(() => {
      memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-detect-changes-"));
    });

    afterEach(() => {
      fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it("detects newly added files", () => {
      fs.writeFileSync(path.join(memoryDir, "new.md"), "# New file");
      const changes = detectChanges(memoryDir);
      expect(changes.length).toBe(1);
      expect(changes[0].type).toBe("added");
      expect(changes[0].file).toBe("new.md");
    });

    it("detects no changes on second scan with no modifications", () => {
      fs.writeFileSync(path.join(memoryDir, "stable.md"), "# Stable");
      detectChanges(memoryDir);
      const changes = detectChanges(memoryDir);
      expect(changes.length).toBe(0);
    });

    it("detects modified files", () => {
      const filePath = path.join(memoryDir, "modify.md");
      fs.writeFileSync(filePath, "# Original");
      detectChanges(memoryDir);

      const stat = fs.statSync(filePath);
      fs.writeFileSync(filePath, "# Modified content that is different");
      fs.utimesSync(filePath, new Date(), new Date(stat.mtimeMs + 10000));

      const changes = detectChanges(memoryDir);
      expect(changes.some((c) => c.type === "modified" && c.file === "modify.md")).toBe(true);
    });

    it("detects deleted files", () => {
      const filePath = path.join(memoryDir, "deleteme.md");
      fs.writeFileSync(filePath, "# Will be deleted");
      detectChanges(memoryDir);
      fs.unlinkSync(filePath);

      const changes = detectChanges(memoryDir);
      expect(changes.some((c) => c.type === "deleted" && c.file === "deleteme.md")).toBe(true);
    });

    it("only tracks .md files", () => {
      fs.writeFileSync(path.join(memoryDir, "readme.md"), "# Markdown");
      fs.writeFileSync(path.join(memoryDir, "data.json"), '{"key":"value"}');
      fs.writeFileSync(path.join(memoryDir, "script.js"), "console.log()");

      const changes = detectChanges(memoryDir);
      expect(changes).toHaveLength(1);
      expect(changes[0].file).toBe("readme.md");
    });

    it("appends changes to history", () => {
      fs.writeFileSync(path.join(memoryDir, "first.md"), "# First");
      detectChanges(memoryDir);

      fs.writeFileSync(path.join(memoryDir, "second.md"), "# Second");
      detectChanges(memoryDir);

      const allChanges = loadChanges();
      expect(allChanges.length).toBe(2);
    });
  });
});
