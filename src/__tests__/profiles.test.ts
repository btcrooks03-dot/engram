import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { profilesDir } = vi.hoisted(() => {
  const _path = require("path");
  const _os = require("os");
  return { profilesDir: _path.join(_os.tmpdir(), "engram-profiles-test-dir") };
});

vi.mock("../constants.js", () => {
  const _path = require("path");
  const _os = require("os");
  return {
    PROFILES_DIR: profilesDir,
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
    CLAUDE_DIR: _path.join(_os.tmpdir(), "engram-profiles-test-claude"),
    PROJECTS_DIR: _path.join(_os.tmpdir(), "engram-profiles-test-claude", "projects"),
    DATA_DIR: _path.join(_os.tmpdir(), "engram-profiles-test-data"),
    STORE_PATH: _path.join(_os.tmpdir(), "engram-profiles-test-data", "audit-history.json"),
    CHANGELOG_PATH: _path.join(_os.tmpdir(), "engram-profiles-test-data", "changelog.json"),
    SESSIONS_PATH: _path.join(_os.tmpdir(), "engram-profiles-test-data", "sessions.json"),
    CHANGES_PATH: _path.join(_os.tmpdir(), "engram-profiles-test-data", "file-changes.json"),
    SNAPSHOTS_PATH: _path.join(_os.tmpdir(), "engram-profiles-test-data", "file-snapshots.json"),
  };
});

import { sanitizeProfileName, saveProfile, loadProfile, deleteProfile } from "../profiles.js";

describe("sanitizeProfileName", () => {
  it("strips path traversal characters", () => {
    expect(sanitizeProfileName("../../../etc/passwd")).toBe("etcpasswd");
  });

  it("strips special characters", () => {
    expect(sanitizeProfileName("my profile!@#$%")).toBe("myprofile");
  });

  it("allows hyphens and underscores", () => {
    expect(sanitizeProfileName("my-profile_v2")).toBe("my-profile_v2");
  });

  it("allows alphanumeric characters", () => {
    expect(sanitizeProfileName("TestProfile123")).toBe("TestProfile123");
  });

  it("truncates to 64 characters", () => {
    const long = "a".repeat(100);
    expect(sanitizeProfileName(long)).toHaveLength(64);
  });

  it("returns empty string for all-special input", () => {
    expect(sanitizeProfileName("!@#$%^&*()")).toBe("");
  });

  it("strips slashes", () => {
    expect(sanitizeProfileName("path/to/file")).toBe("pathtofile");
    expect(sanitizeProfileName("path\\to\\file")).toBe("pathtofile");
  });

  it("strips dots", () => {
    expect(sanitizeProfileName("name.with.dots")).toBe("namewithdots");
  });
});

describe("saveProfile / loadProfile / deleteProfile", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-profiles-integ-"));
    memoryDir = path.join(tmpDir, "test-project", "memory");

    fs.mkdirSync(memoryDir, { recursive: true });
    fs.mkdirSync(profilesDir, { recursive: true });

    fs.writeFileSync(
      path.join(memoryDir, "MEMORY.md"),
      "- [User](user.md) — user info\n"
    );
    fs.writeFileSync(
      path.join(memoryDir, "user.md"),
      `---
name: User
description: User preferences
type: user
---

User content.`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(profilesDir, { recursive: true, force: true });
  });

  it("saveProfile copies memory files to profile directory", () => {
    const result = saveProfile(memoryDir, "test-save");
    expect(result).toContain("test-save");
    expect(result).toContain("2 files");
  });

  it("saveProfile rejects invalid profile names", () => {
    const result = saveProfile(memoryDir, "!@#$");
    expect(result).toContain("Invalid profile name");
  });

  it("deleteProfile removes the profile", () => {
    saveProfile(memoryDir, "to-delete");
    const result = deleteProfile(memoryDir, "to-delete");
    expect(result).toContain("deleted");
  });

  it("deleteProfile returns message for non-existent profile", () => {
    const result = deleteProfile(memoryDir, "nonexistent");
    expect(result).toContain("not found");
  });

  it("deleteProfile rejects invalid names", () => {
    const result = deleteProfile(memoryDir, "!@#$");
    expect(result).toContain("Invalid profile name");
  });

  it("loadProfile returns error for non-existent profile", () => {
    const result = loadProfile(memoryDir, "nonexistent");
    expect(result).toContain("not found");
  });

  it("loadProfile rejects invalid names", () => {
    const result = loadProfile(memoryDir, "!@#$");
    expect(result).toContain("Invalid profile name");
  });

  it("loadProfile restores files and creates backup", () => {
    saveProfile(memoryDir, "my-profile");

    fs.writeFileSync(path.join(memoryDir, "new_file.md"), "# New content");

    const result = loadProfile(memoryDir, "my-profile");
    expect(result).toContain("my-profile");
    expect(result).toContain("loaded");
    expect(result).toContain("_previous_auto_backup");

    expect(fs.existsSync(path.join(memoryDir, "new_file.md"))).toBe(false);
    expect(fs.existsSync(path.join(memoryDir, "MEMORY.md"))).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, "user.md"))).toBe(true);
  });

  it("loadProfile fails for profile without MEMORY.md", () => {
    const projectKey = path.basename(path.dirname(memoryDir));
    const badProfileDir = path.join(profilesDir, projectKey, "bad-profile");
    fs.mkdirSync(badProfileDir, { recursive: true });
    fs.writeFileSync(path.join(badProfileDir, "somefile.md"), "content");

    const result = loadProfile(memoryDir, "bad-profile");
    expect(result).toContain("invalid");
  });
});
