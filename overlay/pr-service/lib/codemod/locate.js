/**
 * Shared strategy for finding the node an edit refers to.
 *
 * A structural path (`Hero:div[0]>h1[0]`) was the other option considered. It
 * was rejected: it would have to be generated identically by three build
 * plugins and re-derived by the server, and it breaks the moment anyone wraps
 * an element in a new container — a refactor that leaves the text untouched.
 * A position hint plus a text match degrades better, because the text itself
 * is what the editor actually changed.
 *
 * Candidates are ranked, best first:
 *   1. exact line and column, text matches
 *   2. exact line, text matches
 *   3. within a few lines, text matches
 *   4. unique text match anywhere in the file
 */

/** How far from the reported line a match is still considered positional. */
const NEAR_LINES = 3;

export const MATCH = {
  EXACT: "exact",
  LINE: "line",
  NEAR: "near",
  UNIQUE_TEXT: "unique-text",
};

/**
 * @param {Array<{line: number, column: number, text: string, node: *}>} candidates
 *        every text-bearing node found in the file
 * @param {{sourceLine?: number, sourceColumn?: number, originalText: string}} edit
 * @returns {{node: *, match: string}|null}
 */
export function chooseCandidate(candidates, edit) {
  const wanted = edit.originalText.trim();
  const matching = candidates.filter((c) => c.text.trim() === wanted);

  if (matching.length === 0) return null;

  const line = edit.sourceLine;

  if (typeof line === "number" && Number.isFinite(line)) {
    const exact = matching.find(
      (c) => c.line === line && c.column === edit.sourceColumn
    );
    if (exact) return { node: exact.node, match: MATCH.EXACT };

    const sameLine = matching.find((c) => c.line === line);
    if (sameLine) return { node: sameLine.node, match: MATCH.LINE };

    const near = matching
      .filter((c) => Math.abs(c.line - line) <= NEAR_LINES)
      .sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0];
    if (near) return { node: near.node, match: MATCH.NEAR };
  }

  // No usable position, or the file has drifted too far. Only accept a text
  // match when it is unambiguous — patching the wrong one of several
  // identical strings is worse than reporting a failure.
  if (matching.length === 1) {
    return { node: matching[0].node, match: MATCH.UNIQUE_TEXT };
  }

  return null;
}

/** Human-readable reason an edit could not be placed. */
export function describeFailure(candidates, edit) {
  const wanted = edit.originalText.trim();
  const matching = candidates.filter((c) => c.text.trim() === wanted);

  if (matching.length === 0) {
    return `Could not find the text "${wanted}" in ${edit.sourceFile}. The file has changed since the preview was built.`;
  }
  return `The text "${wanted}" appears ${matching.length} times in ${edit.sourceFile} and none is near line ${edit.sourceLine}. Cannot tell which one to change.`;
}
