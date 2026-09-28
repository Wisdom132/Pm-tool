/**
 * Ranking candidate source files for text that carries no build annotation.
 *
 * Split out of the old `lib/locate-source.js`: this half is pure and tested,
 * the other half was an Octokit client and now lives in `locate.service.ts`
 * behind the provider interface.
 *
 * Nothing here decides anything. Candidates are ranked and returned for a
 * human to confirm, because the alternative — letting a model pick and then
 * committing to its choice — is how an edit silently lands in the wrong
 * file.
 */

/** Only the best few candidates are worth resolving and showing. */
export const MAX_CANDIDATES = 5;

/** Short strings match everything; searching for them is noise. */
export const MIN_SEARCH_LENGTH = 8;

const SOURCE_EXTS = new Set([
  '.tsx', '.jsx', '.ts', '.js', '.mjs', '.vue', '.svelte', '.html', '.htm', '.json',
]);

export function isSourcePath(path) {
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
export function findLine(content, text) {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => line.includes(text));
  return index === -1 ? null : index + 1;
}

/** Best paths first, source files only, capped. */
export function rankCandidates(paths) {
  return paths
    .filter(isSourcePath)
    .sort((a, b) => scorePath(b) - scorePath(a))
    .slice(0, MAX_CANDIDATES);
}
