/**
 * rei-memory.mjs — Persistent agent memory bank with BM25-style retrieval.
 *
 * Goes beyond `execute-learning.mjs` (which tracks run outcomes). This module
 * stores arbitrary, durable knowledge that Rei picks up across runs:
 *
 *   - fact      : something true about the codebase or domain
 *                 ("`tools/execute-worker.mjs` uses AbortController for timeout")
 *   - pattern   : a recurring success/failure pattern
 *                 ("React state updates inside render = infinite loop")
 *   - decision  : an architectural choice with reasoning
 *                 ("Picked BM25 over embeddings — no API key needed")
 *   - warning   : something to avoid
 *                 ("Don't run npm install in CI without --no-audit")
 *   - solution  : proven fix for a class of problems
 *                 ("EADDRINUSE → lsof -ti:PORT | xargs kill -9")
 *
 * Storage:
 *   - .rei-memory/knowledge.jsonl  (append-only)
 *   - Indexed in-memory on read using term frequency
 *
 * Search:
 *   - Lightweight BM25-like scoring (no embeddings, no API key)
 *   - Tokenize → lowercase → strip punct → IDF * TF per term
 *   - Falls back gracefully when corpus is small
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { projectRoot } from "./execute-worker-state.mjs";

export const memoryDir = path.join(projectRoot, ".rei-memory");
export const memoryFile = path.join(memoryDir, "knowledge.jsonl");

const MAX_ENTRIES = 1000;
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "in", "on", "at", "to", "for", "of", "by", "with", "from", "as",
  "and", "or", "but", "if", "then", "else", "this", "that", "these", "those",
  "it", "its", "their", "them", "they", "we", "our", "us", "you", "your",
  "i", "me", "my", "do", "does", "did", "doing", "have", "has", "had",
  "not", "no", "so", "up", "out", "about", "than", "into", "over"
]);

/** Tokenize text → array of normalized terms (lowercased, stopwords removed). */
export function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s\-./]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t.length <= 40 && !STOPWORDS.has(t));
}

/** Compute term frequency map for a doc. */
function termFreq(tokens) {
  const tf = new Map();
  for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
  return tf;
}

/** Append a memory entry. Returns the stored entry. */
export async function recordMemory({
  type = "fact",
  topic = "",
  content = "",
  source = null,
  tags = [],
  importance = 0.5
} = {}) {
  if (!content || typeof content !== "string") {
    throw new Error("recordMemory: content is required");
  }

  await fs.mkdir(memoryDir, { recursive: true });

  const entry = {
    id: `mem_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    type: ["fact", "pattern", "decision", "warning", "solution"].includes(type) ? type : "fact",
    topic: String(topic).slice(0, 200),
    content: String(content).slice(0, 4000),
    source: source ? String(source).slice(0, 200) : null,
    tags: Array.isArray(tags) ? tags.slice(0, 10).map((t) => String(t).slice(0, 40)) : [],
    importance: typeof importance === "number" ? Math.max(0, Math.min(1, importance)) : 0.5,
    createdAt: new Date().toISOString()
  };

  await fs.appendFile(memoryFile, JSON.stringify(entry) + "\n", "utf8");

  // Compact if file grows too large
  await maybeCompact();

  return entry;
}

/** Read all memory entries. */
export async function readMemory() {
  try {
    const raw = await fs.readFile(memoryFile, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Compact memory file to MAX_ENTRIES (keep most-recent + highest-importance). */
async function maybeCompact() {
  const entries = await readMemory();
  if (entries.length <= MAX_ENTRIES) return;

  // Sort: importance desc, then createdAt desc — keep top MAX_ENTRIES
  entries.sort((a, b) => {
    const dImp = (b.importance ?? 0.5) - (a.importance ?? 0.5);
    if (dImp !== 0) return dImp;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
  const trimmed = entries.slice(0, MAX_ENTRIES);

  // Restore chronological order for append-only feel
  trimmed.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  await fs.writeFile(
    memoryFile,
    trimmed.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8"
  );
}

/** Build IDF table from corpus. IDF(t) = log(N / df(t)). */
function buildIdf(corpus) {
  const N = corpus.length;
  const df = new Map();
  for (const doc of corpus) {
    const seen = new Set();
    for (const tok of doc.tokens) {
      if (!seen.has(tok)) {
        df.set(tok, (df.get(tok) || 0) + 1);
        seen.add(tok);
      }
    }
  }
  const idf = new Map();
  for (const [tok, freq] of df) {
    idf.set(tok, Math.log(1 + (N - freq + 0.5) / (freq + 0.5)));
  }
  return idf;
}

/**
 * Search memory entries by relevance.
 *
 * @param {string} query - natural-language query
 * @param {object} opts
 * @param {number} opts.limit - max results (default 5)
 * @param {string[]} opts.types - filter by type
 * @param {string[]} opts.tags - require ALL these tags
 * @param {number} opts.minScore - threshold (default 0.1)
 * @returns {Promise<Array>} ranked matches with {score, entry}
 */
export async function searchMemory(query, {
  limit = 5,
  types = null,
  tags = null,
  minScore = 0.1
} = {}) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  let entries = await readMemory();

  // Filter
  if (Array.isArray(types) && types.length > 0) {
    entries = entries.filter((e) => types.includes(e.type));
  }
  if (Array.isArray(tags) && tags.length > 0) {
    entries = entries.filter((e) =>
      tags.every((t) => Array.isArray(e.tags) && e.tags.includes(t))
    );
  }

  if (entries.length === 0) return [];

  // Build corpus with tokens
  const corpus = entries.map((entry) => {
    const text = `${entry.topic} ${entry.content} ${(entry.tags || []).join(" ")}`;
    return { entry, tokens: tokenize(text), tf: termFreq(tokenize(text)) };
  });

  const idf = buildIdf(corpus);

  // BM25-like score (simplified)
  const k1 = 1.5;
  const b = 0.75;
  const avgDocLen = corpus.reduce((sum, d) => sum + d.tokens.length, 0) / corpus.length || 1;

  const scored = corpus.map((doc) => {
    let score = 0;
    for (const qt of queryTokens) {
      const tf = doc.tf.get(qt) || 0;
      if (tf === 0) continue;
      const idfVal = idf.get(qt) || 0;
      const docLen = doc.tokens.length;
      const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * docLen / avgDocLen));
      score += idfVal * norm;
    }
    // Boost by importance
    score *= 0.7 + 0.6 * (doc.entry.importance ?? 0.5);
    return { score, entry: doc.entry };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((r) => r.score >= minScore).slice(0, limit);
}

/** Get recent memories (chronological reverse). */
export async function getRecentMemories({ limit = 10, types = null } = {}) {
  let entries = await readMemory();
  if (Array.isArray(types) && types.length > 0) {
    entries = entries.filter((e) => types.includes(e.type));
  }
  return entries.slice(-limit).reverse();
}

/**
 * Format a list of memories into a prompt-injectable string.
 * Designed to be concise — fits in a context window slice.
 */
export function formatMemoryContext(memories = [], { title = "Relevant memory" } = {}) {
  if (!Array.isArray(memories) || memories.length === 0) return "";

  const lines = [`### ${title}`, ""];
  for (const m of memories) {
    const entry = m.entry || m;
    const prefix = {
      fact: "📌",
      pattern: "🔁",
      decision: "🧭",
      warning: "⚠️",
      solution: "🛠️"
    }[entry.type] || "•";
    const topic = entry.topic ? ` **${entry.topic}** — ` : "";
    lines.push(`${prefix}${topic}${entry.content}`);
  }
  return lines.join("\n");
}

/** Auto-extract memory from a completed run's last-message text. */
export async function extractMemoryFromRun({
  lastMessage,
  outcome,
  issueNumber,
  changedFiles = []
} = {}) {
  if (!lastMessage || typeof lastMessage !== "string") return [];
  const recorded = [];
  const text = lastMessage.slice(0, 4000);

  // Pattern: "I discovered/learned/found that ..."
  const factPatterns = [
    /(?:i (?:discovered|learned|found|noticed)|turns out|important note|key insight)[:\s—]+([^.\n]{20,300})/gi,
  ];
  // Pattern: "fixed by", "solved by"
  const solutionPatterns = [
    /(?:fixed|solved|resolved) by ([^.\n]{15,300})/gi,
  ];
  // Pattern: "be careful", "watch out", "don't"
  const warningPatterns = [
    /(?:be careful|watch out|don't|avoid)[:\s,]*([^.\n]{15,300})/gi,
  ];

  const tryExtract = async (patterns, type) => {
    for (const re of patterns) {
      for (const match of text.matchAll(re)) {
        const content = match[1].trim();
        if (content.length < 15) continue;
        const entry = await recordMemory({
          type,
          topic: content.split(/\s+/).slice(0, 6).join(" "),
          content,
          source: issueNumber ? `issue:${issueNumber}` : "run",
          tags: changedFiles.length > 0 ? [`area:${changedFiles[0].split("/")[0]}`] : [],
          importance: outcome === "completed" ? 0.6 : 0.4
        });
        recorded.push(entry);
      }
    }
  };

  await tryExtract(factPatterns, "fact");
  await tryExtract(solutionPatterns, "solution");
  await tryExtract(warningPatterns, "warning");

  return recorded;
}
