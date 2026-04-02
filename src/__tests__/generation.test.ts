import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractKeyPhrases, generateDescriptions, generateMerge } from "../generation.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("extractKeyPhrases", () => {
  it("extracts bigrams and trigrams from text", () => {
    const phrases = extractKeyPhrases("python deployment pipeline infrastructure monitoring alerts");
    const phraseTexts = phrases.map((p) => p.phrase);
    // Should contain bigrams like "python deployment", "deployment pipeline"
    expect(phraseTexts.some((p) => p.includes("python") && p.includes("deployment"))).toBe(true);
  });

  it("returns phrases sorted by score descending", () => {
    const phrases = extractKeyPhrases(
      "python python python deployment deployment pipeline infrastructure monitoring"
    );
    for (let i = 0; i < phrases.length - 1; i++) {
      expect(phrases[i].score).toBeGreaterThanOrEqual(phrases[i + 1].score);
    }
  });

  it("includes significant single words (length >= 6 or freq >= 2)", () => {
    const phrases = extractKeyPhrases("infrastructure monitoring infrastructure");
    const phraseTexts = phrases.map((p) => p.phrase);
    // "infrastructure" appears twice and is >= 6 chars
    expect(phraseTexts).toContain("infrastructure");
    // "monitoring" is >= 6 chars
    expect(phraseTexts).toContain("monitoring");
  });

  it("filters stop words from phrases", () => {
    const phrases = extractKeyPhrases("the deployment with the infrastructure");
    const phraseTexts = phrases.map((p) => p.phrase);
    // Stop words should not form bigrams on their own
    expect(phraseTexts.every((p) => !p.match(/^(the|with|from|this)\s/))).toBe(true);
  });

  it("returns empty array for empty input", () => {
    const phrases = extractKeyPhrases("");
    expect(phrases).toEqual([]);
  });
});

describe("generateDescriptions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-gen-desc-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suggests improved descriptions for files with short descriptions", () => {
    // Create MEMORY.md index
    fs.writeFileSync(
      path.join(tmpDir, "MEMORY.md"),
      "- [Short](short.md) — A short desc\n"
    );
    // Create a memory file with a short description
    fs.writeFileSync(
      path.join(tmpDir, "short.md"),
      `---
name: Short
description: short
type: project
---

This memory covers python deployment pipelines infrastructure monitoring kubernetes docker containerization and orchestration patterns.`
    );

    const suggestions = generateDescriptions(tmpDir);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].file).toBe("short.md");
    expect(suggestions[0].currentLength).toBe(5);
    expect(suggestions[0].suggestedLength).toBeGreaterThan(5);
    expect(suggestions[0].reason).toContain("too short");
  });

  it("does not suggest improvements for files with good descriptions", () => {
    fs.writeFileSync(
      path.join(tmpDir, "MEMORY.md"),
      "- [Good](good.md) — A well-described memory file\n"
    );
    fs.writeFileSync(
      path.join(tmpDir, "good.md"),
      `---
name: Good Memory
description: Detailed description covering python deployment pipelines and infrastructure
type: project
---

Body content about deployment.`
    );

    const suggestions = generateDescriptions(tmpDir);
    expect(suggestions.length).toBe(0);
  });
});

describe("generateMerge", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-gen-merge-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges two files, deduplicating lines", () => {
    fs.writeFileSync(
      path.join(tmpDir, "a.md"),
      `---
name: File A
description: Description A is longer than B
type: project
---

Line one
Line two
Shared line`
    );
    fs.writeFileSync(
      path.join(tmpDir, "b.md"),
      `---
name: File B
description: Short B
type: feedback
---

Shared line
Line three`
    );

    const result = generateMerge(tmpDir, "a.md", "b.md");
    expect(typeof result).not.toBe("string"); // not an error
    if (typeof result === "string") return;

    expect(result.file1).toBe("a.md");
    expect(result.file2).toBe("b.md");
    expect(result.mergedFilename).toBe("a.md");
    // "Shared line" should appear only once in merged content
    const sharedCount = result.mergedContent.split("Shared line").length - 1;
    expect(sharedCount).toBe(1);
    // Longer description wins
    expect(result.mergedContent).toContain("Description A is longer than B");
    // Should save lines
    expect(result.linesSaved).toBeGreaterThan(0);
  });

  it("returns error string when file not found", () => {
    const result = generateMerge(tmpDir, "nonexistent.md", "also_missing.md");
    expect(typeof result).toBe("string");
    expect(result as string).toContain("File not found");
  });

  it("preserves frontmatter type from first file", () => {
    fs.writeFileSync(
      path.join(tmpDir, "x.md"),
      `---
name: X
description: X desc
type: feedback
---

Content X`
    );
    fs.writeFileSync(
      path.join(tmpDir, "y.md"),
      `---
name: Y
description: Y description that is longer
type: project
---

Content Y`
    );

    const result = generateMerge(tmpDir, "x.md", "y.md");
    if (typeof result === "string") return;
    // Type comes from fm1 (first file) which is "feedback"
    expect(result.mergedContent).toContain("type: feedback");
  });

  it("uses the longer description between the two files", () => {
    fs.writeFileSync(
      path.join(tmpDir, "short.md"),
      `---
name: Short
description: Hi
type: project
---

Body short`
    );
    fs.writeFileSync(
      path.join(tmpDir, "long.md"),
      `---
name: Long
description: This is a much longer and more detailed description
type: project
---

Body long`
    );

    const result = generateMerge(tmpDir, "short.md", "long.md");
    if (typeof result === "string") return;
    expect(result.mergedContent).toContain("This is a much longer and more detailed description");
  });
});
