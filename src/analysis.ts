import { STOP_WORDS } from "./constants.js";
import { scanProjectMemory, getProjectKey } from "./scanning.js";
import type { MemoryFile, DuplicatePair, RelevanceScore, EffectivenessScore } from "./types.js";

export function tokenize(text: string): Set<string> {
  // Remove frontmatter, then extract words
  const body = text.replace(/^---[\s\S]*?---\n?/, "");
  const words = body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

export function extractBigrams(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
}

export function bigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

// Check for exact substring matches (phrases) between task and text
export function phraseMatchScore(task: string, text: string): number {
  const taskLower = task.toLowerCase();
  const textLower = text.toLowerCase();
  // Extract 2-4 word phrases from task
  const taskWords = taskLower.split(/\s+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  let matches = 0;
  let total = 0;
  for (let len = 2; len <= Math.min(4, taskWords.length); len++) {
    for (let i = 0; i <= taskWords.length - len; i++) {
      const phrase = taskWords.slice(i, i + len).join(" ");
      total++;
      if (textLower.includes(phrase)) matches++;
    }
  }
  return total > 0 ? matches / total : 0;
}

export function analyzeDuplicates(files: MemoryFile[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const tokenSets = files.map((f) => ({ file: f.filename, tokens: tokenize(f.content) }));

  for (let i = 0; i < tokenSets.length; i++) {
    for (let j = i + 1; j < tokenSets.length; j++) {
      const sim = jaccardSimilarity(tokenSets[i].tokens, tokenSets[j].tokens);
      if (sim > 0.2) {
        // Find shared significant words
        const shared = [...tokenSets[i].tokens].filter((w) => tokenSets[j].tokens.has(w));
        // Filter to longer, more meaningful words
        const topics = shared.filter((w) => w.length > 3).slice(0, 10);
        pairs.push({
          file1: tokenSets[i].file,
          file2: tokenSets[j].file,
          similarity: Math.round(sim * 100) / 100,
          sharedTopics: topics,
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

export function simulateRelevance(taskDescription: string, memoryDir: string): RelevanceScore[] {
  const project = scanProjectMemory(memoryDir, getProjectKey(memoryDir));
  if (!project) return [];

  const taskTokens = tokenize(taskDescription);
  const taskBigrams = extractBigrams(taskDescription);

  return project.files
    .map((file) => {
      // Description scoring (primary signal — 60% weight)
      const descTokens = tokenize(file.description);
      const descBigrams = extractBigrams(file.description);
      const descUnigram = jaccardSimilarity(taskTokens, descTokens);
      const descBigram = bigramSimilarity(taskBigrams, descBigrams);
      const descPhrase = phraseMatchScore(taskDescription, file.description);

      // Content scoring (secondary signal — 30% weight)
      const contentTokens = tokenize(file.content);
      const contentBigrams = extractBigrams(file.content);
      const contentUnigram = jaccardSimilarity(taskTokens, contentTokens);
      const contentBigram = bigramSimilarity(taskBigrams, contentBigrams);

      // Type bonus (10% weight) — feedback and user memories are generally more relevant
      const typeBonus = file.type === "feedback" ? 0.05 : file.type === "user" ? 0.03 : 0;

      // Combined score
      const descScore = descUnigram * 0.3 + descBigram * 0.4 + descPhrase * 0.3;
      const contentScore = contentUnigram * 0.5 + contentBigram * 0.5;
      const score = Math.round((descScore * 0.6 + contentScore * 0.3 + typeBonus) * 1000) / 1000;

      // Confidence: based on how much signal we have
      const totalMatches = [...taskTokens].filter((t) => descTokens.has(t) || contentTokens.has(t)).length;
      const confidence: "high" | "medium" | "low" =
        (descBigram > 0.1 || descPhrase > 0.2) ? "high" :
        totalMatches >= 3 ? "medium" : "low";

      // Matched terms and phrases
      const matchedTerms = [...taskTokens].filter((t) => descTokens.has(t) || contentTokens.has(t));
      const matchedPhrases: string[] = [];
      const taskWords = taskDescription.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
      for (let len = 2; len <= Math.min(3, taskWords.length); len++) {
        for (let i = 0; i <= taskWords.length - len; i++) {
          const phrase = taskWords.slice(i, i + len).join(" ");
          if (file.description.toLowerCase().includes(phrase) || file.content.toLowerCase().includes(phrase)) {
            matchedPhrases.push(phrase);
          }
        }
      }

      return {
        file: file.filename,
        description: file.description,
        type: file.type,
        score,
        confidence,
        matchedTerms: matchedTerms.slice(0, 10),
        matchedPhrases: [...new Set(matchedPhrases)].slice(0, 5),
        breakdown: {
          descUnigram: Math.round(descUnigram * 1000) / 1000,
          descBigram: Math.round(descBigram * 1000) / 1000,
          descPhrase: Math.round(descPhrase * 1000) / 1000,
          contentUnigram: Math.round(contentUnigram * 1000) / 1000,
          contentBigram: Math.round(contentBigram * 1000) / 1000,
        },
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function calculateEffectiveness(memoryDir: string): EffectivenessScore[] {
  const project = scanProjectMemory(memoryDir, getProjectKey(memoryDir));
  if (!project) return [];

  // Precompute token sets for uniqueness scoring
  const allTokenSets = project.files.map((f) => ({
    file: f.filename,
    tokens: tokenize(f.content),
  }));

  const now = Date.now();
  const results: EffectivenessScore[] = [];

  for (let i = 0; i < project.files.length; i++) {
    const file = project.files[i];
    const issues: string[] = [];

    // 1. Description quality (0-25)
    let descQuality = 0;
    if (file.description.length >= 50) descQuality = 25;
    else if (file.description.length >= 30) descQuality = 15;
    else if (file.description.length >= 10) descQuality = 5;
    else { descQuality = 0; issues.push("Description too short for relevance matching"); }

    // Check description specificity — penalize generic words
    const descWords = file.description.toLowerCase().split(/\s+/);
    const genericDescWords = new Set(["info", "data", "notes", "stuff", "things", "misc", "general", "various"]);
    const genericCount = descWords.filter((w) => genericDescWords.has(w)).length;
    if (genericCount > 0) {
      descQuality = Math.max(0, descQuality - genericCount * 5);
      issues.push(`Description contains ${genericCount} generic term(s)`);
    }

    // 2. Freshness (0-25)
    let freshness = 25;
    const ageMs = now - new Date(file.mtime).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (file.type === "project") {
      // Project memories decay fast
      if (ageDays > 90) { freshness = 0; issues.push("Project memory >90 days old — likely stale"); }
      else if (ageDays > 30) { freshness = 10; issues.push("Project memory >30 days old — review for staleness"); }
      else if (ageDays > 14) freshness = 20;
    } else if (file.type === "reference") {
      // References decay slowly
      if (ageDays > 180) { freshness = 10; issues.push("Reference >6 months old — verify links still work"); }
    } else {
      // User and feedback memories are fairly stable
      if (ageDays > 365) { freshness = 15; issues.push("Memory >1 year old — verify still accurate"); }
    }

    // 3. Uniqueness (0-25) — how distinct is this from other memories?
    let uniqueness = 25;
    let maxSim = 0;
    for (let j = 0; j < allTokenSets.length; j++) {
      if (i === j) continue;
      const sim = jaccardSimilarity(allTokenSets[i].tokens, allTokenSets[j].tokens);
      if (sim > maxSim) maxSim = sim;
    }
    if (maxSim > 0.6) { uniqueness = 5; issues.push(`High overlap (${Math.round(maxSim * 100)}%) with another memory — consider merging`); }
    else if (maxSim > 0.4) { uniqueness = 15; issues.push(`Moderate overlap (${Math.round(maxSim * 100)}%) with another memory`); }

    // 4. Density (0-15) — useful content per line
    const body = file.content.replace(/^---[\s\S]*?---\n?/, "");
    const bodyLines = body.split("\n").filter((l) => l.trim());
    const totalLines = bodyLines.length;
    const emptyOrHeader = body.split("\n").filter((l) => !l.trim() || l.trim().startsWith("#")).length;
    const densityRatio = totalLines > 0 ? (totalLines - emptyOrHeader) / totalLines : 0;
    let density = Math.round(densityRatio * 15);
    if (totalLines < 2) { density = 5; issues.push("Very short memory — may not provide enough context"); }
    if (totalLines > 30) { density = Math.max(5, density - 5); issues.push("Long memory — consider trimming to essential information"); }

    // 5. Type appropriateness (0-10)
    let typeScore = 10;
    const validTypes = ["user", "feedback", "project", "reference"];
    if (!validTypes.includes(file.type)) {
      typeScore = 0;
      issues.push(`Invalid type "${file.type}" — must be one of: ${validTypes.join(", ")}`);
    }

    const total = descQuality + freshness + uniqueness + density + typeScore;

    results.push({
      file: file.filename,
      name: file.name,
      type: file.type,
      score: total,
      breakdown: {
        descriptionQuality: descQuality,
        freshness,
        uniqueness,
        density,
        typeAppropriateness: typeScore,
      },
      issues,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
