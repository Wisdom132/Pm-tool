/**
 * Find candidate source files for text that carries no build annotation.
 *
 * Replaces the previous approach, which walked the whole git tree and
 * fetched every source file individually — one API call per file, per edit —
 * then asked a model to pick between matches and committed to whatever it
 * chose. That cost thousands of calls on a large repo and could silently
 * patch the wrong file.
 *
 * This asks GitHub's code search once, then reads only the top few files to
 * resolve exact line numbers. Nothing here decides anything: candidates are
 * returned for a human to confirm.
 */

import { Octokit } from '@octokit/rest';
import { getFileContent } from './github.js';
import { log } from './logger.js';

/** Only the best few candidates are worth resolving and showing. */
const MAX_CANDIDATES = 5;

/** Short strings match everything; searching for them is noise. */
export const MIN_SEARCH_LENGTH = 8;

const SOURCE_EXTS = new Set([
  '.tsx', '.jsx', '.ts', '.js', '.mjs', '.vue', '.svelte', '.html', '.htm', '.json',
]);

function isSourcePath(path) {
  const dot = path.lastIndexOf('.');
  return dot !== -1 && SOURCE_EXTS.has(path.slice(dot).toLowerCase());
}

/**
 * Prefer files that look like page or component sources over tests,
 * stories, translations of other locales, and build output.
 */
export function scorePath(path) {
  let score = 0;
  const lower = path.toLowerCase();

  if (/(^|\/)(src|app|components|pages|views)\//.test(lower)) score += 3;
  if (/\.(tsx|jsx|vue|svelte)$/.test(lower)) score += 2;
  if (/(^|\/)(dist|build|out|vendor|node_modules)\//.test(lower)) score -= 6;
  if (/\.(test|spec|stories)\./.test(lower)) score -= 4;
  if (/(^|\/)__(tests|mocks|snapshots)__\//.test(lower)) score -= 4;

  // Shallower paths are usually the real page rather than a fixture.
  score -= path.split('/').length * 0.1;

  return score;
}

/** 1-based line of the first exact occurrence, or null. */
function findLine(content, text) {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => line.includes(text));
  return index === -1 ? null : index + 1;
}

/**
 * @returns {Promise<{candidates: Array<{sourceFile, sourceLine, snippet}>, reason: string|null}>}
 */
export async function findSourceCandidates({ token, owner, repo, branch, text }) {
  const needle = text.trim();

  if (needle.length < MIN_SEARCH_LENGTH) {
    return {
      candidates: [],
      reason: `"${needle}" is too short to search for reliably. Install the annotation plugin, or edit this text in the source.`,
    };
  }

  const octokit = new Octokit({ auth: token });

  let items;
  try {
    // One search call, quoted so it is treated as a phrase.
    const { data } = await octokit.search.code({
      q: `"${needle.replace(/"/g, '')}" repo:${owner}/${repo}`,
      per_page: 20,
    });
    items = data.items || [];
  } catch (err) {
    log.warn('locate.search_failed', { repo: `${owner}/${repo}`, error: err.message });
    return {
      candidates: [],
      reason:
        'GitHub code search could not be reached for this repository. Very new or very large repositories are sometimes not indexed.',
    };
  }

  const ranked = items
    .filter((item) => isSourcePath(item.path))
    .sort((a, b) => scorePath(b.path) - scorePath(a.path))
    .slice(0, MAX_CANDIDATES);

  if (ranked.length === 0) {
    return {
      candidates: [],
      reason: `No source file in ${owner}/${repo} contains this text. It may be generated at runtime, or come from a CMS.`,
    };
  }

  // Resolve exact line numbers against the branch being edited: search is
  // indexed on the default branch and may disagree with it.
  const candidates = [];
  for (const item of ranked) {
    try {
      const { content } = await getFileContent({ token, owner, repo, path: item.path, branch });
      const line = findLine(content, needle);
      if (line === null) continue;
      candidates.push({
        sourceFile: item.path,
        sourceLine: line,
        snippet: content.split('\n')[line - 1].trim().slice(0, 160),
      });
    } catch {
      // Not present on this branch — simply not a candidate.
    }
  }

  log.debug('locate.resolved', {
    repo: `${owner}/${repo}`,
    searched: items.length,
    candidates: candidates.length,
  });

  if (candidates.length === 0) {
    return {
      candidates: [],
      reason: `This text was found in ${owner}/${repo} but not on branch "${branch}".`,
    };
  }

  return { candidates, reason: null };
}
