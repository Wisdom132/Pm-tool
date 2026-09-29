import { describe, it, expect } from 'vitest';
import { issueBody, issueTitle } from '../apps/api/src/feedback/issue-body';

const BASE = {
  message: 'The pricing table says £19 but checkout charges £29.',
  pageUrl: 'https://acme.com/pricing',
  pagePath: '/pricing',
  element: 'main > section:nth-of-type(2) .price',
  sourceFile: 'src/components/PricingTable.vue',
  sourceLine: 42,
  viewport: '1440x900',
  userAgent: 'Mozilla/5.0 (Macintosh)',
  createdAt: new Date('2026-09-29T10:00:00.000Z'),
  source: 'extension',
  author: { name: 'Ada', email: 'ada@acme.com', verified: true },
};

const of = (over = {}) => ({ ...BASE, ...over });

describe('issueTitle', () => {
  it('uses the first sentence and names the page', () => {
    expect(issueTitle(of())).toBe(
      'The pricing table says £19 but checkout charges £29. (/pricing)',
    );
  });

  it('uses only the first line of a multi-line comment', () => {
    const title = issueTitle(of({ message: 'Broken link.\nAlso the footer is wrong.' }));
    expect(title).toBe('Broken link. (/pricing)');
  });

  it('truncates a long comment with no sentence break', () => {
    const title = issueTitle(of({ message: 'x'.repeat(200) }));
    expect(title.length).toBeLessThan(100);
    expect(title).toContain('…');
    expect(title).toContain('(/pricing)');
  });

  it('still produces a title when the message is only whitespace-separated', () => {
    // An empty title is rejected by the provider, so there is always a
    // fallback rather than a failed request.
    expect(issueTitle(of({ message: '  ' }))).toBe('Feedback on /pricing');
  });
});

describe('issueBody', () => {
  it('quotes the reporter, so their words stay visibly theirs', () => {
    expect(issueBody(of())).toContain('> The pricing table says £19');
  });

  it('carries the source file and line — the reason this is worth more than a paste', () => {
    expect(issueBody(of())).toContain('`src/components/PricingTable.vue:42`');
  });

  it('omits the source row when the page was not annotated', () => {
    const body = issueBody(of({ sourceFile: null, sourceLine: null }));
    expect(body).not.toContain('| Source |');
    // Everything else still carries.
    expect(body).toContain('| Page |');
  });

  it('carries the file alone when there is no line', () => {
    const body = issueBody(of({ sourceLine: null }));
    expect(body).toContain('`src/components/PricingTable.vue`');
  });

  it('includes the context nobody types', () => {
    const body = issueBody(of());
    expect(body).toContain('1440x900');
    expect(body).toContain('Mozilla/5.0 (Macintosh)');
    expect(body).toContain('2026-09-29T10:00:00.000Z');
  });

  it('omits context rows that are absent rather than printing empty cells', () => {
    const body = issueBody(of({ viewport: null, userAgent: null, element: null }));
    expect(body).not.toContain('| Viewport |');
    expect(body).not.toContain('| Browser |');
    expect(body).not.toContain('| Element |');
  });

  it('marks a self-declared name as unverified', () => {
    // "Reported by the CFO" reads very differently depending on whether
    // anything checked that.
    const body = issueBody(
      of({ source: 'widget', author: { name: 'The CFO', email: null, verified: false } }),
    );
    expect(body).toContain('The CFO');
    expect(body).toContain('unverified');
    expect(body).toContain('Public widget');
  });

  it('does not mark a signed-in reporter as unverified', () => {
    expect(issueBody(of())).not.toContain('unverified');
  });

  it('escapes a pipe in a selector, so the table does not shift', () => {
    // Attribute selectors contain pipes, so this is not hypothetical.
    const body = issueBody(of({ element: 'a[href|="/x"]' }));
    const row = body.split('\n').find((l) => l.startsWith('| Element |'));
    expect(row).toContain('\\|');
    expect(row.match(/(?<!\\)\|/g)).toHaveLength(3);
  });

  it('does not render a javascript: URL as a link', () => {
    // Whoever reads the issue is one click from it otherwise.
    const body = issueBody(of({ pageUrl: 'javascript:alert(1)' }));
    expect(body).not.toContain('<javascript:');
    expect(body).toContain('`javascript:alert(1)`');
  });

  it('links an ordinary page URL', () => {
    expect(issueBody(of())).toContain('<https://acme.com/pricing>');
  });

  it('links back to the dashboard when given a URL', () => {
    const body = issueBody(of(), 'https://app.inline.dev/feedback/abc');
    expect(body).toContain('[Open in Inline Edit](https://app.inline.dev/feedback/abc)');
  });

  it('omits the dashboard link when there is none', () => {
    expect(issueBody(of())).not.toContain('Open in Inline Edit');
  });

  it('keeps a multi-line comment readable as a quote', () => {
    const body = issueBody(of({ message: 'Line one.\nLine two.' }));
    expect(body).toContain('> Line one.\n> Line two.');
  });
});
