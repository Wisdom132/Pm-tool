/**
 * Pull-request text.
 *
 * Applying edits moved to lib/codemod — the ±2-line string replacement that
 * used to live here could not tell a JSX text node from an attribute, and
 * threw on the first miss, losing the whole pull request.
 */

/**
 * Issue body for observer mode.
 *
 * Nothing here claims to know where the text lives — it records exactly what
 * was seen and what was wanted, with enough context for someone who does.
 */
export function buildIssueBody({ edits, editor, pageUrl, note }) {
  const byPage = new Map();
  for (const edit of edits) {
    const url = edit.pageUrl || pageUrl;
    if (!byPage.has(url)) byPage.set(url, []);
    byPage.get(url).push(edit);
  }

  const sections = [...byPage.entries()].map(([url, pageEdits]) => {
    const rows = pageEdits.map((e) => {
      const where = e.sourceFile
        ? `\`${e.sourceFile}${e.sourceLine ? `:${e.sourceLine}` : ''}\``
        : `\`<${(e.tagName || 'element').toLowerCase()}>\``;
      return `| ${where} | ${e.originalText} | ${e.newText} |`;
    });

    return [
      `### [${new URL(url).pathname || '/'}](${url})`,
      '',
      '| Where | Current | Proposed |',
      '|-------|---------|----------|',
      ...rows,
    ].join('\n');
  });

  const noteSection = note ? `\n**Note:** ${note}\n` : '';
  const editorLine = editor?.login ? `\nReported by **@${editor.login}**` : '';

  return `## Copy changes requested from the browser
${noteSection}
${sections.join('\n\n')}

> These were captured on a page with no build annotation, so the source
> files could not be resolved automatically. Install the annotation plugin
> to let the same edits open a pull request directly.
${editorLine}

---
*Created with Inline Edit Tool*`;
}

export function buildCommitMessage(edits, pageUrl) {
  const host  = new URL(pageUrl).hostname;
  const files = [...new Set(edits.map((e) => e.sourceFile))].join(', ');
  return `inline-edit: update copy via ${host}\n\nFiles: ${files}`;
}

/**
 * Describe how the preview the editor was looking at relates to the branch.
 * Returns '' when the preview was current, or there was nothing to compare.
 */
export function buildStalenessNote(staleness) {
  if (!staleness || staleness.status === 'identical') return '';

  if (!staleness.usable) {
    return (
      `\n> **⚠️ Preview was built from a commit that is no longer on this branch** ` +
      `(the branch was rebased or force-pushed). These edits were applied to the ` +
      `current branch tip instead, so review them carefully.\n`
    );
  }

  return (
    `\n> **ℹ️ Preview was ${staleness.behindBy} commit(s) behind** this branch. ` +
    `Edits were applied to the exact commit the preview was built from, so this ` +
    `PR contains only the changes made in the browser.\n`
  );
}

export function buildPrBody({ edits, skipped = [], editor, pageUrl, note, staleness }) {
  const rows = edits.map((e) => {
    const file = `\`${e.sourceFile}:${e.sourceLine || '?'}\``;
    const tag  = e._foundViaSearch ? ' *(located via search)*' : '';
    return `| ${file}${tag} | ${e.originalText} | ${e.newText} |`;
  });

  const table = [
    '| File | Before | After |',
    '|------|--------|-------|',
    ...rows,
  ].join('\n');

  // Each skipped edit carries its own reason when the codemod produced one,
  // so the author can tell "file moved" apart from "text is ambiguous".
  const skippedSection = skipped.length > 0
    ? `\n> **⚠️ ${skipped.length} edit(s) not applied:**\n${skipped
        .map((e) => {
          const why = e.reason ? ` — ${e.reason}` : ' — source file could not be located';
          return `> - "${e.originalText}" → "${e.newText}"${why}`;
        })
        .join('\n')}\n`
    : '';

  const noteSection = note ? `\n**Note:** ${note}\n` : '';
  const editorLine  = editor?.login ? `\nOpened by **@${editor.login}**` : '';
  const staleSection = buildStalenessNote(staleness);

  return `## Inline edits from [${new URL(pageUrl).hostname}](${pageUrl})
${noteSection}
${table}
${skippedSection}${staleSection}${editorLine}

---
*Created with [Inline Edit Tool](https://github.com)*`;
}
