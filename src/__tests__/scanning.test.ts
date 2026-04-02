import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getProjectKey, reverseProjectKey, scanProjectMemory } from "../scanning.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("getProjectKey", () => {
  it("returns the parent directory name of the memory dir", () => {
    const key = getProjectKey("/Users/ben/.claude/projects/-Users-ben-myproject/memory");
    expect(key).toBe("-Users-ben-myproject");
  });

  it("returns 'default' when parent is empty or root", () => {
    const key = getProjectKey("/memory");
    expect(key).toBe("default");
  });

  it("handles nested project paths", () => {
    const key = getProjectKey("/some/path/deep-project/memory");
    expect(key).toBe("deep-project");
  });
});

describe("reverseProjectKey", () => {
  it("converts dash-separated project key back to path", () => {
    const result = reverseProjectKey("-Users-ben-myproject");
    expect(result).toBe("/Users/ben/myproject");
  });

  it("returns null for keys not starting with dash", () => {
    const result = reverseProjectKey("default");
    expect(result).toBeNull();
  });

  it("handles deeply nested paths", () => {
    const result = reverseProjectKey("-Users-ben-code-projects-myapp");
    expect(result).toBe("/Users/ben/code/projects/myapp");
  });
});

describe("scanProjectMemory", () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-scan-test-"));
    memoryDir = path.join(tmpDir, "test-project", "memory");
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when MEMORY.md does not exist", () => {
    const result = scanProjectMemory(memoryDir, "test-project");
    expect(result).toBeNull();
  });

  it("scans a valid memory directory with index and linked files", () => {
    // Create MEMORY.md index
    fs.writeFileSync(
      path.join(memoryDir, "MEMORY.md"),
      `# Memory
- [User Role](user_role.md) — describes the user
- [Project Context](project_context.md) — project details
`
    );
    // Create linked memory files
    fs.writeFileSync(
      path.join(memoryDir, "user_role.md"),
      `---
name: User Role
description: Describes the user and their preferences
type: user
---

Ben is a developer.`
    );
    fs.writeFileSync(
      path.join(memoryDir, "project_context.md"),
      `---
name: Project Context
description: Details about the current project architecture and stack
type: project
---

TypeScript MCP server project.`
    );

    const result = scanProjectMemory(memoryDir, "test-project");
    expect(result).not.toBeNull();
    expect(result!.project).toBe("test-project");
    expect(result!.files).toHaveLength(2);
    expect(result!.files[0].filename).toBe("user_role.md");
    expect(result!.files[0].name).toBe("User Role");
    expect(result!.files[0].type).toBe("user");
    expect(result!.files[1].filename).toBe("project_context.md");
    expect(result!.orphans).toHaveLength(0);
    expect(result!.deadLinks).toHaveLength(0);
  });

  it("detects dead links (index references non-existent files)", () => {
    fs.writeFileSync(
      path.join(memoryDir, "MEMORY.md"),
      "- [Missing](missing.md) — this file does not exist\n"
    );

    const result = scanProjectMemory(memoryDir, "test-project");
    expect(result).not.toBeNull();
    expect(result!.deadLinks).toContain("missing.md");
    expect(result!.files).toHaveLength(0);
  });

  it("detects orphan files (not linked in index)", () => {
    fs.writeFileSync(path.join(memoryDir, "MEMORY.md"), "# Memory\n");
    fs.writeFileSync(path.join(memoryDir, "orphan.md"), "# Orphan\nNot linked anywhere.");

    const result = scanProjectMemory(memoryDir, "test-project");
    expect(result).not.toBeNull();
    expect(result!.orphans).toContain("orphan.md");
  });

  it("calculates index capacity percentage", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`).join("\n");
    fs.writeFileSync(path.join(memoryDir, "MEMORY.md"), lines);

    const result = scanProjectMemory(memoryDir, "test-project");
    expect(result).not.toBeNull();
    expect(result!.indexLines).toBe(50);
    // LINE_CAP is 200, so 50/200 = 25%
    expect(result!.indexCapPct).toBe(25);
  });

  it("reads frontmatter from memory files", () => {
    fs.writeFileSync(
      path.join(memoryDir, "MEMORY.md"),
      "- [Test](test.md) — test file\n"
    );
    fs.writeFileSync(
      path.join(memoryDir, "test.md"),
      `---
name: Test Memory
description: "A quoted description value"
type: feedback
---

Content here.`
    );

    const result = scanProjectMemory(memoryDir, "test-project");
    expect(result).not.toBeNull();
    expect(result!.files[0].name).toBe("Test Memory");
    expect(result!.files[0].description).toBe("A quoted description value");
    expect(result!.files[0].type).toBe("feedback");
  });
});
