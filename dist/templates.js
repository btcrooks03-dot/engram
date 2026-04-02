import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { DATA_DIR } from "./constants.js";
import { readJson } from "./helpers.js";
// ─── Template Loading ───────────────────────────────────────────────────────
const BUILT_IN_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "templates");
const CUSTOM_TEMPLATES_DIR = path.join(DATA_DIR, "custom-templates");
function loadTemplatesFromDir(dir) {
    if (!fs.existsSync(dir))
        return [];
    const templates = [];
    try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
        for (const file of files) {
            const data = readJson(path.join(dir, file));
            if (data && data.id && data.name && Array.isArray(data.memories)) {
                templates.push(data);
            }
        }
    }
    catch {
        // Directory unreadable — skip silently
    }
    return templates;
}
export function listAllTemplates() {
    const builtIn = loadTemplatesFromDir(BUILT_IN_DIR).map((t) => ({
        ...t,
        source: "built-in",
    }));
    const custom = loadTemplatesFromDir(CUSTOM_TEMPLATES_DIR).map((t) => ({
        ...t,
        source: "custom",
    }));
    return [...builtIn, ...custom];
}
export function findTemplate(id) {
    const all = listAllTemplates();
    return all.find((t) => t.id === id) || null;
}
export function applyTemplate(template, memoryDir) {
    return template.memories.map((mem) => {
        const frontmatter = [
            "---",
            `type: ${mem.type}`,
            `name: ${mem.name}`,
            `description: ${mem.description}`,
            "---",
            "",
        ].join("\n");
        const targetPath = path.join(memoryDir, mem.filename);
        const indexEntry = `- [${mem.name}](${mem.filename}) — ${mem.description}`;
        return {
            filename: mem.filename,
            type: mem.type,
            name: mem.name,
            description: mem.description,
            content_prompts: mem.content_prompts,
            example_content: mem.example_content,
            frontmatter,
            target_path: targetPath,
            index_entry: indexEntry,
        };
    });
}
// ─── Tool Registration ──────────────────────────────────────────────────────
export function registerTemplateTools(server) {
    server.tool("engram_list_templates", "List all available memory templates (built-in and custom). Templates provide pre-structured memory file layouts for specific roles, domains, or workflows. Use this to help users bootstrap their memory quickly.", {}, async () => {
        const templates = listAllTemplates();
        const summary = templates.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            category: t.category,
            source: t.source,
            memory_files: t.memories.map((m) => ({
                filename: m.filename,
                type: m.type,
                name: m.name,
            })),
        }));
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        totalTemplates: templates.length,
                        builtIn: templates.filter((t) => t.source === "built-in").length,
                        custom: templates.filter((t) => t.source === "custom").length,
                        customDir: CUSTOM_TEMPLATES_DIR,
                        templates: summary,
                    }, null, 2),
                },
            ],
        };
    });
    server.tool("engram_apply_template", "Apply a memory template to a memory directory. Returns the file structures ready to create — does NOT auto-create files. Present the results to the user and let them confirm before creating. Includes content_prompts (questions to ask the user) and example_content for each file.", {
        template_id: z.string().describe("ID of the template to apply (from engram_list_templates)"),
        memory_dir: z.string().describe("Path to the memory directory where files will be created"),
    }, async ({ template_id, memory_dir }) => {
        const template = findTemplate(template_id);
        if (!template) {
            const available = listAllTemplates().map((t) => t.id);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            error: `Template "${template_id}" not found`,
                            availableTemplates: available,
                        }, null, 2),
                    },
                ],
            };
        }
        const applied = applyTemplate(template, memory_dir);
        // Check for existing files that would be overwritten
        const conflicts = applied.filter((f) => fs.existsSync(f.target_path));
        const indexContent = [
            `# ${template.name} Memory`,
            "",
            `> Generated from the **${template.name}** template (${template.category})`,
            "",
            ...applied.map((f) => f.index_entry),
            "",
        ].join("\n");
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        template: {
                            id: template.id,
                            name: template.name,
                            description: template.description,
                            category: template.category,
                        },
                        memoryDir: memory_dir,
                        conflicts: conflicts.map((c) => c.filename),
                        suggestedIndex: indexContent,
                        files: applied.map((f) => ({
                            filename: f.filename,
                            type: f.type,
                            name: f.name,
                            description: f.description,
                            target_path: f.target_path,
                            frontmatter: f.frontmatter,
                            content_prompts: f.content_prompts,
                            example_content: f.example_content,
                            index_entry: f.index_entry,
                            already_exists: conflicts.some((c) => c.filename === f.filename),
                        })),
                        instructions: "Present these files to the user. For each file, ask the content_prompts to gather information, then create the file with the frontmatter + user's answers. Create MEMORY.md with the suggestedIndex content. Do NOT auto-create without user confirmation.",
                    }, null, 2),
                },
            ],
        };
    });
}
