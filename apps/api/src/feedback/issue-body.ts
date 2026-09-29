/**
 * Turning a comment into an issue.
 *
 * The comment is the least of what gets carried over. What makes this worth
 * more than copying the text by hand is everything attached to it: the page,
 * the element, and — where the page was annotated — the source file and line
 * that produced it. An engineer opening the issue should not have to ask
 * where.
 */

export interface FeedbackForIssue {
  message: string;
  pageUrl: string;
  pagePath: string;
  element: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  viewport: string | null;
  userAgent: string | null;
  createdAt: Date;
  source: string;
  author: { name: string | null; email: string | null; verified: boolean };
}

/** A one-line title, from the first sentence of the comment. */
export function issueTitle(feedback: FeedbackForIssue): string {
  const firstLine = feedback.message.trim().split('\n')[0].trim();
  const sentence = /^(.{0,70}?[.!?])(\s|$)/.exec(firstLine)?.[1] ?? firstLine;
  const trimmed = sentence.length > 80 ? `${sentence.slice(0, 77).trimEnd()}…` : sentence;

  return trimmed ? `${trimmed} (${feedback.pagePath})` : `Feedback on ${feedback.pagePath}`;
}

/**
 * The issue body.
 *
 * @param webUrl a link back to the comment in the dashboard, when there is one
 */
export function issueBody(feedback: FeedbackForIssue, webUrl?: string): string {
  const lines: string[] = [];

  lines.push(quote(feedback.message), '');

  lines.push('| | |', '| --- | --- |');
  lines.push(`| Page | ${link(feedback.pageUrl)} |`);

  if (feedback.sourceFile) {
    // The differentiator, stated as code so it is copy-pasteable into an
    // editor rather than something to be read and retyped.
    const at = feedback.sourceLine
      ? `\`${feedback.sourceFile}:${feedback.sourceLine}\``
      : `\`${feedback.sourceFile}\``;
    lines.push(`| Source | ${at} |`);
  }

  if (feedback.element) lines.push(`| Element | \`${escapeCell(feedback.element)}\` |`);
  if (feedback.viewport) lines.push(`| Viewport | ${escapeCell(feedback.viewport)} |`);
  if (feedback.userAgent) lines.push(`| Browser | ${escapeCell(feedback.userAgent)} |`);

  lines.push(`| Reported | ${feedback.createdAt.toISOString()} |`);
  lines.push(`| Via | ${feedback.source === 'widget' ? 'Public widget' : 'Extension'} |`);

  // An unverified name is one an anonymous visitor typed into a box. Saying
  // so in the issue matters: "Reported by the CFO" reads very differently
  // depending on whether anything checked that.
  const who = feedback.author.name ?? feedback.author.email;
  if (who) {
    lines.push(
      `| Reported by | ${escapeCell(who)}${feedback.author.verified ? '' : ' _(self-declared, unverified)_'} |`,
    );
  }

  if (webUrl) lines.push('', `[Open in Inline Edit](${webUrl})`);

  return lines.join('\n');
}

/** Markdown blockquote, so the reporter's words stay visibly theirs. */
function quote(message: string): string {
  return message
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * A URL as a link, or as plain text when it is not one we would follow.
 *
 * The URL came from a page we do not control. Rendering a `javascript:` URL
 * as a markdown link puts it one click away for whoever reads the issue.
 */
function link(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return `\`${escapeCell(url)}\``;
    return `<${parsed.toString()}>`;
  } catch {
    return `\`${escapeCell(url)}\``;
  }
}

/**
 * Make a value safe to sit in a markdown table cell.
 *
 * A pipe would end the cell early and shift every column after it; a
 * backtick would close the code span this is usually inside. Both appear in
 * ordinary CSS selectors, so neither is hypothetical.
 */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/`/g, "'").replace(/\r?\n/g, ' ');
}
