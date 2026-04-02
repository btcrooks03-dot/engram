import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseFrontmatter, extractLinks, ensureDir, readJson, writeJson } from "../helpers.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with simple values", () => {
    const content = `---
name: My Memory
description: A useful memory file
type: project
---

Body content here.`;
    const fm = parseFrontmatter(content);
    expect(fm).toEqual({
      name: "My Memory",
      description: "A useful memory file",
      type: "project",
    });
  });

  it("strips surrounding double quotes from values", () => {
    const content = `---
name: "Quoted Name"
description: "A quoted description"
---

Body.`;
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe("Quoted Name");
    expect(fm.description).toBe("A quoted description");
  });

  it("strips surrounding single quotes from values", () => {
    const content = `---
name: 'Single Quoted'
---

Body.`;
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe("Single Quoted");
  });

  it("returns empty object when no frontmatter present", () => {
    const content = "Just a regular markdown file.\n\nNo frontmatter here.";
    const fm = parseFrontmatter(content);
    expect(fm).toEqual({});
  });

  it("returns empty object for malformed frontmatter (no closing ---)", () => {
    const content = `---
name: Broken
This never closes`;
    const fm = parseFrontmatter(content);
    expect(fm).toEqual({});
  });

  it("handles frontmatter with colons in values", () => {
    const content = `---
name: URL Reference
description: Points to https://example.com:8080/path
---

Body.`;
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe("URL Reference");
    expect(fm.description).toBe("Points to https://example.com:8080/path");
  });

  it("skips lines without colons", () => {
    const content = `---
name: Valid
this line has no colon
type: user
---

Body.`;
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe("Valid");
    expect(fm.type).toBe("user");
    expect(Object.keys(fm)).toHaveLength(2);
  });

  it("handles empty frontmatter block", () => {
    const content = `---

---

Body.`;
    const fm = parseFrontmatter(content);
    expect(fm).toEqual({});
  });
});

describe("extractLinks", () => {
  it("extracts markdown links", () => {
    const content = `- [User Role](user_role.md) — describes the user
- [Project Context](project_context.md) — project details`;
    const links = extractLinks(content);
    expect(links).toEqual([
      { title: "User Role", file: "user_role.md" },
      { title: "Project Context", file: "project_context.md" },
    ]);
  });

  it("extracts inline links within text", () => {
    const content = "Check out [the docs](docs.md) for more info about [config](config.md).";
    const links = extractLinks(content);
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ title: "the docs", file: "docs.md" });
    expect(links[1]).toEqual({ title: "config", file: "config.md" });
  });

  it("returns empty array for content with no links", () => {
    const content = "No links here, just plain text.\n\nAnother paragraph.";
    const links = extractLinks(content);
    expect(links).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(extractLinks("")).toEqual([]);
  });

  it("handles links with paths", () => {
    const content = "[Deep Link](subdir/nested/file.md)";
    const links = extractLinks(content);
    expect(links).toEqual([{ title: "Deep Link", file: "subdir/nested/file.md" }]);
  });
});

describe("ensureDir / readJson / writeJson", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-helpers-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ensureDir creates nested directories", () => {
    const nested = path.join(tmpDir, "a", "b", "c");
    expect(fs.existsSync(nested)).toBe(false);
    ensureDir(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("ensureDir is idempotent", () => {
    const dir = path.join(tmpDir, "exists");
    ensureDir(dir);
    ensureDir(dir); // should not throw
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("writeJson writes and readJson reads back", () => {
    const filePath = path.join(tmpDir, "data.json");
    const data = { key: "value", count: 42, nested: { a: 1 } };
    writeJson(filePath, data);
    const result = readJson(filePath);
    expect(result).toEqual(data);
  });

  it("readJson returns null for non-existent file", () => {
    expect(readJson(path.join(tmpDir, "nope.json"))).toBeNull();
  });

  it("readJson returns null for invalid JSON", () => {
    const filePath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(filePath, "not valid json {{{", "utf-8");
    expect(readJson(filePath)).toBeNull();
  });

  it("writeJson creates parent directories", () => {
    const filePath = path.join(tmpDir, "sub", "dir", "file.json");
    writeJson(filePath, { ok: true });
    expect(readJson(filePath)).toEqual({ ok: true });
  });
});
