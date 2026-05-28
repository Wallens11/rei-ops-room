/**
 * rei-codebase-graph.mjs — Lightweight repo knowledge graph.
 *
 * Before Rei touches code, she scans the repo and builds a map of:
 *   - exported symbols (functions, classes, constants) per file
 *   - import edges (who depends on whom)
 *   - file sizes + last-modified
 *   - rough language mix
 *
 * No tree-sitter, no LSP. Regex-based, fast, "good enough" for
 * grounding the agent's prompt: "you already know these symbols exist,
 * don't redefine them; this file imports that file; pattern X is used in
 * 12 places."
 *
 * Caches to .rei-memory/codebase-graph.json. Refresh on demand or when
 * any tracked file's mtime exceeds the cache mtime.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { projectRoot } from "./execute-worker-state.mjs";

const CACHE_FILE = path.join(projectRoot, ".rei-memory", "codebase-graph.json");

const SOURCE_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".rb", ".go", ".rs", ".java", ".kt",
  ".vue", ".svelte"
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "out", "coverage", ".cache", ".turbo", ".vercel", "target",
  "__pycache__", ".venv", "venv", ".rei-memory", ".execute-runs",
  "demo-frames", ".claude"
]);

const MAX_FILES = 800;       // hard cap to keep graphs cheap
const MAX_FILE_BYTES = 200_000;

// ─── Walk ──────────────────────────────────────────────────────────────────

async function walk(dir, root, out) {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXT.has(ext)) continue;
      out.push(path.relative(root, full));
    }
  }
}

// ─── Extract symbols + imports ────────────────────────────────────────────

const EXPORT_PATTERNS = [
  /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /export\s+class\s+([A-Za-z_$][\w$]*)/g,
  /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /export\s+\{\s*([^}]+)\s*\}/g,
  /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)?/g
];

const PY_PATTERNS = [
  /^(?:async\s+)?def\s+([A-Za-z_][\w]*)/gm,
  /^class\s+([A-Za-z_][\w]*)/gm
];

const IMPORT_PATTERNS = [
  /import\s+(?:[\w*{}\s,]+)\s+from\s+["']([^"']+)["']/g,
  /import\s+["']([^"']+)["']/g,
  /require\(\s*["']([^"']+)["']\s*\)/g,
  /^from\s+([\w.]+)\s+import/gm
];

function extractSymbols(source, isPython) {
  const symbols = new Set();
  const patterns = isPython ? PY_PATTERNS : EXPORT_PATTERNS;
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      const raw = m[1];
      if (!raw) continue;
      // Handle re-exports: export { a, b as c }
      if (raw.includes(",") || raw.includes(" as ")) {
        for (const piece of raw.split(",")) {
          const name = piece.trim().split(/\s+as\s+/i).pop().trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) symbols.add(name);
        }
      } else if (/^[A-Za-z_$][\w$]*$/.test(raw)) {
        symbols.add(raw);
      }
    }
  }
  return Array.from(symbols);
}

function extractImports(source) {
  const imports = new Set();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      const target = m[1];
      if (target) imports.add(target);
    }
  }
  return Array.from(imports);
}

// ─── Build graph ──────────────────────────────────────────────────────────

export async function buildCodebaseGraph(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = [];
  await walk(root, root, files);

  const nodes = {};
  const langCounts = {};
  let totalBytes = 0;

  for (const rel of files) {
    const full = path.join(root, rel);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      nodes[rel] = { size: stat.size, mtime: stat.mtimeMs, symbols: [], imports: [], skipped: "too_large" };
      continue;
    }
    let source;
    try {
      source = await fs.readFile(full, "utf8");
    } catch {
      continue;
    }
    totalBytes += stat.size;
    const ext = path.extname(rel).toLowerCase();
    langCounts[ext] = (langCounts[ext] || 0) + 1;
    const isPython = ext === ".py";
    nodes[rel] = {
      size: stat.size,
      mtime: stat.mtimeMs,
      symbols: extractSymbols(source, isPython),
      imports: extractImports(source)
    };
  }

  // Reverse-index: symbol → files that define it
  const symbolIndex = {};
  for (const [rel, node] of Object.entries(nodes)) {
    for (const sym of node.symbols || []) {
      (symbolIndex[sym] = symbolIndex[sym] || []).push(rel);
    }
  }

  const graph = {
    builtAt: new Date().toISOString(),
    root,
    fileCount: Object.keys(nodes).length,
    totalBytes,
    langCounts,
    nodes,
    symbolIndex
  };

  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(graph), "utf8");
  return graph;
}

export async function loadCodebaseGraph({ repoRoot, maxAgeMs = 10 * 60 * 1000 } = {}) {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf8");
    const graph = JSON.parse(raw);
    const age = Date.now() - new Date(graph.builtAt).getTime();
    if (age < maxAgeMs && (!repoRoot || graph.root === path.resolve(repoRoot))) {
      return graph;
    }
  } catch {}
  if (!repoRoot) return null;
  return buildCodebaseGraph(repoRoot);
}

// ─── Issue-targeted lookup ────────────────────────────────────────────────

/**
 * Given an issue title + body, score each file by keyword overlap with its
 * path + symbols and return the top-N most relevant files. Cheap, no NLP.
 */
export function findRelevantFiles(graph, query, { limit = 8 } = {}) {
  if (!graph || !graph.nodes) return [];
  const terms = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return [];

  const scored = [];
  for (const [rel, node] of Object.entries(graph.nodes)) {
    const haystack = (
      rel.toLowerCase() + " " +
      (node.symbols || []).join(" ").toLowerCase()
    );
    let score = 0;
    for (const t of terms) {
      if (haystack.includes(t)) score += 1;
      if (rel.toLowerCase().includes(t)) score += 1; // path match worth more
    }
    if (score > 0) scored.push({ rel, score, symbols: node.symbols || [] });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Format the graph as a compact prompt block. Keeps the agent grounded
 * without dumping the whole map.
 */
export function formatCodebaseContext(graph, { query = "", limit = 8 } = {}) {
  if (!graph) return null;
  const lines = [];
  lines.push("📚 Codebase map (what's already there — don't redefine):");
  lines.push(
    `- ${graph.fileCount} source files indexed (${(graph.totalBytes / 1024).toFixed(0)}KB)`
  );

  const topLangs = Object.entries(graph.langCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([ext, n]) => `${ext}:${n}`)
    .join(", ");
  if (topLangs) lines.push(`- Languages: ${topLangs}`);

  const relevant = findRelevantFiles(graph, query, { limit });
  if (relevant.length > 0) {
    lines.push("");
    lines.push("Most relevant existing files for this task:");
    for (const hit of relevant) {
      const syms = hit.symbols.slice(0, 5).join(", ");
      lines.push(`  • ${hit.rel}${syms ? ` — exports: ${syms}` : ""}`);
    }
    lines.push("→ Read these first. Extend them; don't shadow them.");
  }

  return lines.join("\n");
}
