import { describe, it, expect } from "vitest";
import { listAllTemplates, findTemplate, applyTemplate } from "../templates.js";
import type { MemoryTemplate } from "../templates.js";
import * as path from "path";

describe("templates module", () => {
  describe("listAllTemplates", () => {
    it("loads all 7 built-in templates", () => {
      const templates = listAllTemplates();
      const builtIn = templates.filter((t) => t.source === "built-in");
      expect(builtIn.length).toBe(7);
    });

    it("each template has required fields", () => {
      const templates = listAllTemplates();
      for (const t of templates) {
        expect(t.id).toBeDefined();
        expect(t.id.length).toBeGreaterThan(0);
        expect(t.name).toBeDefined();
        expect(t.name.length).toBeGreaterThan(0);
        expect(t.description).toBeDefined();
        expect(["role", "domain", "workflow"]).toContain(t.category);
        expect(Array.isArray(t.memories)).toBe(true);
        expect(t.memories.length).toBeGreaterThan(0);
      }
    });

    it("each template memory entry has required fields", () => {
      const templates = listAllTemplates();
      for (const t of templates) {
        for (const mem of t.memories) {
          expect(mem.filename).toBeDefined();
          expect(mem.filename.endsWith(".md")).toBe(true);
          expect(["user", "feedback", "project", "reference"]).toContain(mem.type);
          expect(mem.name).toBeDefined();
          expect(mem.description).toBeDefined();
          expect(Array.isArray(mem.content_prompts)).toBe(true);
        }
      }
    });

    it("has templates from expected categories", () => {
      const templates = listAllTemplates();
      const categories = new Set(templates.map((t) => t.category));
      // At least role and domain should be present
      expect(categories.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe("findTemplate", () => {
    it("finds a template by ID", () => {
      const templates = listAllTemplates();
      const firstId = templates[0].id;
      const found = findTemplate(firstId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(firstId);
    });

    it("returns null for non-existent template ID", () => {
      const found = findTemplate("nonexistent-template-id-12345");
      expect(found).toBeNull();
    });
  });

  describe("applyTemplate", () => {
    it("generates correct file structures from a template", () => {
      const templates = listAllTemplates();
      const template = templates[0];
      const memoryDir = "/tmp/test-memory";

      const applied = applyTemplate(template, memoryDir);

      expect(applied.length).toBe(template.memories.length);

      for (let i = 0; i < applied.length; i++) {
        const mem = template.memories[i];
        const app = applied[i];

        expect(app.filename).toBe(mem.filename);
        expect(app.type).toBe(mem.type);
        expect(app.name).toBe(mem.name);
        expect(app.description).toBe(mem.description);
        expect(app.content_prompts).toEqual(mem.content_prompts);
        expect(app.target_path).toBe(path.join(memoryDir, mem.filename));
      }
    });

    it("generates valid frontmatter for each file", () => {
      const templates = listAllTemplates();
      const template = templates[0];

      const applied = applyTemplate(template, "/tmp/memory");

      for (const file of applied) {
        expect(file.frontmatter).toContain("---");
        expect(file.frontmatter).toContain(`type: ${file.type}`);
        expect(file.frontmatter).toContain(`name: ${file.name}`);
        expect(file.frontmatter).toContain(`description: ${file.description}`);
      }
    });

    it("generates correct index entries", () => {
      const templates = listAllTemplates();
      const template = templates[0];

      const applied = applyTemplate(template, "/tmp/memory");

      for (const file of applied) {
        expect(file.index_entry).toContain(`[${file.name}]`);
        expect(file.index_entry).toContain(`(${file.filename})`);
        expect(file.index_entry).toContain(file.description);
      }
    });

    it("works for each built-in template without errors", () => {
      const templates = listAllTemplates();
      for (const template of templates) {
        const applied = applyTemplate(template, "/tmp/test");
        expect(applied.length).toBe(template.memories.length);
        // Every file should have a non-empty frontmatter
        for (const file of applied) {
          expect(file.frontmatter.length).toBeGreaterThan(10);
        }
      }
    });
  });
});
