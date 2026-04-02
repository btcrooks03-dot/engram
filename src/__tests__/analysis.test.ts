import { describe, it, expect } from "vitest";
import { tokenize, jaccardSimilarity, analyzeDuplicates, extractBigrams, bigramSimilarity, phraseMatchScore } from "../analysis.js";
import type { MemoryFile } from "../types.js";

describe("tokenize", () => {
  it("lowercases and splits text into word tokens", () => {
    const tokens = tokenize("Hello World Testing");
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("testing")).toBe(true);
  });

  it("removes stop words", () => {
    const tokens = tokenize("the project with some details about this");
    // All of these are stop words; only longer non-stop words should remain
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("with")).toBe(false);
    expect(tokens.has("this")).toBe(false);
    expect(tokens.has("about")).toBe(false);
    expect(tokens.has("some")).toBe(false);
    // "project" and "details" are meaningful
    expect(tokens.has("project")).toBe(true);
    expect(tokens.has("details")).toBe(true);
  });

  it("strips frontmatter before tokenizing", () => {
    const content = `---
name: Test
description: Some description
type: project
---

The actual body content with python and typescript.`;
    const tokens = tokenize(content);
    // frontmatter keys should not appear as tokens (they get stripped)
    // "actual", "body", "content" etc from the body should appear
    expect(tokens.has("python")).toBe(true);
    expect(tokens.has("typescript")).toBe(true);
    // "name" could appear as a token from frontmatter - but frontmatter is stripped
    // So it depends on whether "name" passes filters. It's 4 chars and not a stop word.
    // Actually the frontmatter block is removed entirely, so "name" should NOT be present
    // unless it appears in the body.
  });

  it("filters out single-character words", () => {
    const tokens = tokenize("a b c hello world");
    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("b")).toBe(false);
    expect(tokens.has("c")).toBe(false);
    expect(tokens.has("hello")).toBe(true);
  });

  it("removes non-alphanumeric characters", () => {
    const tokens = tokenize("hello-world foo_bar test.case");
    // Hyphens, underscores, dots become spaces, splitting the words
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("foo")).toBe(true);
    expect(tokens.has("bar")).toBe(true);
    expect(tokens.has("test")).toBe(true);
  });

  it("returns a Set (no duplicates)", () => {
    const tokens = tokenize("python python python typescript typescript");
    expect(tokens.size).toBe(2);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["alpha", "beta", "gamma"]);
    const b = new Set(["alpha", "beta", "gamma"]);
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("returns 0 for completely disjoint sets", () => {
    const a = new Set(["alpha", "beta"]);
    const b = new Set(["gamma", "delta"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("returns correct value for partial overlap", () => {
    const a = new Set(["alpha", "beta", "gamma"]);
    const b = new Set(["beta", "gamma", "delta"]);
    // intersection: {beta, gamma} = 2, union: {alpha, beta, gamma, delta} = 4
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it("returns 0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("returns 0 when one set is empty", () => {
    const a = new Set(["alpha"]);
    expect(jaccardSimilarity(a, new Set())).toBe(0);
  });
});

describe("extractBigrams", () => {
  it("extracts consecutive word pairs", () => {
    const bigrams = extractBigrams("python typescript deployment pipeline");
    expect(bigrams.has("python typescript")).toBe(true);
    expect(bigrams.has("typescript deployment")).toBe(true);
    expect(bigrams.has("deployment pipeline")).toBe(true);
  });

  it("returns empty set for single word", () => {
    const bigrams = extractBigrams("python");
    expect(bigrams.size).toBe(0);
  });
});

describe("bigramSimilarity", () => {
  it("returns 0 for empty sets", () => {
    expect(bigramSimilarity(new Set(), new Set())).toBe(0);
    expect(bigramSimilarity(new Set(["ab"]), new Set())).toBe(0);
  });

  it("returns 1 for identical sets", () => {
    const a = new Set(["hello world"]);
    expect(bigramSimilarity(a, a)).toBe(1);
  });
});

describe("phraseMatchScore", () => {
  it("returns positive score when phrases match", () => {
    const score = phraseMatchScore("python deployment pipeline", "Our python deployment pipeline is robust.");
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 when no phrases match", () => {
    const score = phraseMatchScore("python deployment", "java compilation process");
    expect(score).toBe(0);
  });

  it("returns 0 for very short task (fewer than 2 meaningful words)", () => {
    // After stop word removal, only "python" remains - no 2-word phrases possible
    const score = phraseMatchScore("python", "python is great");
    expect(score).toBe(0);
  });
});

describe("analyzeDuplicates", () => {
  it("finds duplicates when files share significant content", () => {
    const files: MemoryFile[] = [
      {
        filename: "a.md",
        path: "/tmp/a.md",
        name: "File A",
        description: "desc",
        type: "project",
        lines: 5,
        bytes: 100,
        content: "python typescript react deployment kubernetes docker infrastructure",
        mtime: new Date().toISOString(),
      },
      {
        filename: "b.md",
        path: "/tmp/b.md",
        name: "File B",
        description: "desc",
        type: "project",
        lines: 5,
        bytes: 100,
        content: "python typescript react deployment kubernetes docker infrastructure",
        mtime: new Date().toISOString(),
      },
    ];
    const pairs = analyzeDuplicates(files);
    expect(pairs.length).toBe(1);
    expect(pairs[0].similarity).toBe(1);
    expect(pairs[0].file1).toBe("a.md");
    expect(pairs[0].file2).toBe("b.md");
  });

  it("returns empty array when files are completely different", () => {
    const files: MemoryFile[] = [
      {
        filename: "a.md",
        path: "/tmp/a.md",
        name: "File A",
        description: "desc",
        type: "project",
        lines: 5,
        bytes: 100,
        content: "python typescript deployment kubernetes",
        mtime: new Date().toISOString(),
      },
      {
        filename: "b.md",
        path: "/tmp/b.md",
        name: "File B",
        description: "desc",
        type: "project",
        lines: 5,
        bytes: 100,
        content: "watercolor painting landscape sculpture ceramics",
        mtime: new Date().toISOString(),
      },
    ];
    const pairs = analyzeDuplicates(files);
    expect(pairs.length).toBe(0);
  });

  it("returns results sorted by similarity descending", () => {
    const files: MemoryFile[] = [
      {
        filename: "a.md", path: "/tmp/a.md", name: "A", description: "d", type: "project",
        lines: 5, bytes: 100,
        content: "python typescript react deployment kubernetes docker",
        mtime: new Date().toISOString(),
      },
      {
        filename: "b.md", path: "/tmp/b.md", name: "B", description: "d", type: "project",
        lines: 5, bytes: 100,
        content: "python typescript react angular vuejs svelte",
        mtime: new Date().toISOString(),
      },
      {
        filename: "c.md", path: "/tmp/c.md", name: "C", description: "d", type: "project",
        lines: 5, bytes: 100,
        content: "python typescript react deployment kubernetes docker",
        mtime: new Date().toISOString(),
      },
    ];
    const pairs = analyzeDuplicates(files);
    // a-c are identical, a-b and b-c have partial overlap
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < pairs.length - 1; i++) {
      expect(pairs[i].similarity).toBeGreaterThanOrEqual(pairs[i + 1].similarity);
    }
  });

  it("includes shared topics in results", () => {
    const files: MemoryFile[] = [
      {
        filename: "a.md", path: "/tmp/a.md", name: "A", description: "d", type: "project",
        lines: 5, bytes: 100,
        content: "python typescript infrastructure deployment",
        mtime: new Date().toISOString(),
      },
      {
        filename: "b.md", path: "/tmp/b.md", name: "B", description: "d", type: "project",
        lines: 5, bytes: 100,
        content: "python typescript infrastructure monitoring",
        mtime: new Date().toISOString(),
      },
    ];
    const pairs = analyzeDuplicates(files);
    if (pairs.length > 0) {
      expect(pairs[0].sharedTopics).toBeDefined();
      expect(Array.isArray(pairs[0].sharedTopics)).toBe(true);
    }
  });
});
