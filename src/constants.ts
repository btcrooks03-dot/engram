import * as path from "path";
import * as os from "os";

export const CLAUDE_DIR = path.join(os.homedir(), ".claude");
export const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
export const DATA_DIR = path.join(CLAUDE_DIR, "plugins", "data", "engram");
export const STORE_PATH = path.join(DATA_DIR, "audit-history.json");
export const PROFILES_DIR = path.join(DATA_DIR, "profiles");
export const MEMORY_INDEX = "MEMORY.md";
export const LINE_CAP = 200;
export const SIZE_CAP = 25600; // 25KB
export const CHANGELOG_PATH = path.join(DATA_DIR, "changelog.json");
export const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");
export const CHANGES_PATH = path.join(DATA_DIR, "file-changes.json");
export const SNAPSHOTS_PATH = path.join(DATA_DIR, "file-snapshots.json");

export const STOP_WORDS = new Set([
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
]);
