export interface MemoryFile {
  filename: string;
  path: string;
  name: string;
  description: string;
  type: string;
  lines: number;
  bytes: number;
  content: string;
  mtime: string;
}

export interface ProjectMemory {
  project: string;
  memoryDir: string;
  indexPath: string;
  indexLines: number;
  indexBytes: number;
  indexCapPct: number;
  sizeCapPct: number;
  files: MemoryFile[];
  orphans: string[];
  deadLinks: string[];
}

export interface DuplicatePair {
  file1: string;
  file2: string;
  similarity: number;
  sharedTopics: string[];
}

export interface Suggestion {
  type: "missing_feedback" | "missing_project" | "missing_reference" | "stale_candidate" | "pattern";
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

export interface ClaudeMdFile {
  path: string;
  scope: string; // "global", "project", "directory"
  lines: number;
  bytes: number;
  content: string;
}

export interface ClaudeMdIssue {
  file: string;
  type: "bloat" | "contradiction" | "stale" | "overlap_with_memory" | "missing";
  detail: string;
  severity: "high" | "medium" | "low";
}

export interface AuditRecord {
  timestamp: string;
  project: string;
  score: number;
  issueCount: number;
  lineUsage: number;
  sizeUsage: number;
  fileCount: number;
  details?: string;
}

export interface FileChange {
  file: string;
  type: "added" | "modified" | "deleted";
  timestamp: string;
  sizeDelta?: number;
}

export interface DerivableItem {
  file: string;
  line: string;
  type: "file_path" | "cli_command" | "function_name" | "config_value";
  found_at: string;
}

export interface RelevanceScore {
  file: string;
  description: string;
  type: string;
  score: number;
  confidence: "high" | "medium" | "low";
  matchedTerms: string[];
  matchedPhrases: string[];
  breakdown: { descUnigram: number; descBigram: number; descPhrase: number; contentUnigram: number; contentBigram: number };
}

export interface DescriptionSuggestion {
  file: string;
  currentDescription: string;
  currentLength: number;
  suggestedDescription: string;
  suggestedLength: number;
  reason: string;
}

export interface MergeResult {
  file1: string;
  file2: string;
  similarity: number;
  mergedFilename: string;
  mergedContent: string;
  mergedLines: number;
  originalTotalLines: number;
  linesSaved: number;
}

export interface EffectivenessScore {
  file: string;
  name: string;
  type: string;
  score: number;
  breakdown: {
    descriptionQuality: number;
    freshness: number;
    uniqueness: number;
    density: number;
    typeAppropriateness: number;
  };
  issues: string[];
}

export interface ChangelogEntry {
  timestamp: string;
  operation: string;
  files: string[];
  details: string;
}

export interface SessionRecord {
  timestamp: string;
  project?: string;
  topics: string[];
  memoryDir?: string;
}

export interface CoverageGap {
  topic: string;
  frequency: number;
  bestMemoryMatch: string;
  bestScore: number;
  covered: boolean;
}

export interface BootstrapSuggestion {
  type: "user" | "feedback" | "project" | "reference";
  name: string;
  description: string;
  reasoning: string;
  priority: "high" | "medium" | "low";
  content_hints: string[];
}
