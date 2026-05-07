/**
 * inject-skills.mjs — Install bundled skills into ~/.claude/skills/ before claude-code runs.
 *
 * Claude Code loads skills from ~/.claude/skills/<skill-name>/SKILL.md automatically.
 * We bundle skills in tools/skills/ so the repo is self-contained — no internet needed.
 *
 * Usage:
 *   import { injectSkills } from "./inject-skills.mjs";
 *   await injectSkills();  // idempotent, fast (skips if already up-to-date)
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SKILLS_SRC = path.join(import.meta.dirname, "skills");
const SKILLS_DST = path.join(os.homedir(), ".claude", "skills");

/**
 * Copy all bundled skills to ~/.claude/skills/.
 * Each subdirectory of tools/skills/ is a skill — copied verbatim.
 * Skips a skill if the destination SKILL.md is already identical (byte-for-byte).
 *
 * @returns {{ installed: string[], skipped: string[], errors: string[] }}
 */
export async function injectSkills({ src = SKILLS_SRC, dst = SKILLS_DST } = {}) {
  const result = { installed: [], skipped: [], errors: [] };

  let skillDirs;
  try {
    const entries = await fs.readdir(src, { withFileTypes: true });
    skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (err) {
    if (err?.code === "ENOENT") return result; // no bundled skills — that's fine
    throw err;
  }

  for (const skillName of skillDirs) {
    try {
      const skillSrc = path.join(src, skillName);
      const skillDst = path.join(dst, skillName);

      // Collect all files in the skill directory (recursive)
      const files = await collectFiles(skillSrc);

      let allSame = true;
      for (const relPath of files) {
        const srcFile = path.join(skillSrc, relPath);
        const dstFile = path.join(skillDst, relPath);
        try {
          const [srcBuf, dstBuf] = await Promise.all([
            fs.readFile(srcFile),
            fs.readFile(dstFile)
          ]);
          if (!srcBuf.equals(dstBuf)) { allSame = false; break; }
        } catch {
          allSame = false; break;
        }
      }

      if (allSame && files.length > 0) {
        result.skipped.push(skillName);
        continue;
      }

      // Install: mkdir + copy all files
      for (const relPath of files) {
        const srcFile = path.join(skillSrc, relPath);
        const dstFile = path.join(skillDst, relPath);
        await fs.mkdir(path.dirname(dstFile), { recursive: true });
        await fs.copyFile(srcFile, dstFile);
      }

      result.installed.push(skillName);
    } catch (err) {
      result.errors.push(`${skillName}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Recursively collect relative file paths under a directory.
 */
async function collectFiles(dir, base = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}
