import { describe, it, expect } from 'vitest';
import {
  buildCommitMessage,
  buildPrBody,
  buildIssueBody,
  plural,
} from '../apps/api/src/editing/patcher.js';

describe('buildCommitMessage', () => {
  it('includes the page hostname', () => {
    const msg = buildCommitMessage(
      [{ sourceFile: 'src/Hero.tsx' }],
      'https://preview.example.com/pricing'
    );
    expect(msg).toContain('preview.example.com');
  });

  it('deduplicates repeated file paths', () => {
    const msg = buildCommitMessage(
      [
        { sourceFile: 'src/Hero.tsx' },
        { sourceFile: 'src/Hero.tsx' },
        { sourceFile: 'src/Nav.tsx' },
      ],
      'https://example.com/'
    );
    expect(msg).toContain('Files: src/Hero.tsx, src/Nav.tsx');
  });
});

describe('buildPrBody', () => {
  const base = {
    edits: [
      {
        sourceFile: 'src/Hero.tsx',
        sourceLine: 12,
        originalText: 'Build things that mater',
        newText: 'Build things that matter',
      },
    ],
    editor: { login: 'octocat' },
    pageUrl: 'https://preview.example.com/',
  };

  it('renders a row per edit', () => {
    const body = buildPrBody(base);
    expect(body).toContain('| `src/Hero.tsx:12` | Build things that mater | Build things that matter |');
  });

  it('falls back to ? when the line is unknown', () => {
    const body = buildPrBody({
      ...base,
      edits: [{ ...base.edits[0], sourceLine: undefined }],
    });
    expect(body).toContain('`src/Hero.tsx:?`');
  });

  it('tags edits located via search', () => {
    const body = buildPrBody({
      ...base,
      edits: [{ ...base.edits[0], _foundViaSearch: true }],
    });
    expect(body).toContain('*(located via search)*');
  });

  it('omits the skipped section when nothing was skipped', () => {
    expect(buildPrBody(base)).not.toContain('not applied');
  });

  it('lists skipped edits when present', () => {
    const body = buildPrBody({
      ...base,
      skipped: [{ originalText: 'Home', newText: 'Start' }],
    });
    expect(body).toContain('1 edit(s) not applied');
    expect(body).toContain('"Home" → "Start"');
  });

  it('gives the reason an edit was not applied', () => {
    const body = buildPrBody({
      ...base,
      skipped: [
        { originalText: 'Home', newText: 'Start', reason: 'Text appears 3 times' },
      ],
    });
    expect(body).toContain('Text appears 3 times');
  });

  it('includes the note when given and omits it otherwise', () => {
    expect(buildPrBody({ ...base, note: 'Typo fix' })).toContain('**Note:** Typo fix');
    expect(buildPrBody(base)).not.toContain('**Note:**');
  });

  it('attributes the editor', () => {
    expect(buildPrBody(base)).toContain('Opened by **@octocat**');
  });

  it('omits attribution when there is no login', () => {
    expect(buildPrBody({ ...base, editor: {} })).not.toContain('Opened by');
  });

  it('links back to the page', () => {
    expect(buildPrBody(base)).toContain('[preview.example.com](https://preview.example.com/)');
  });
});

describe('buildIssueBody', () => {
  const base = {
    edits: [
      { originalText: 'Build things that mater', newText: 'Build things that matter', tagName: 'H1', pageUrl: 'https://preview.test/' },
    ],
    editor: { login: 'octocat' },
    pageUrl: 'https://preview.test/',
  };

  it('lists the proposed change', () => {
    const body = buildIssueBody(base);
    expect(body).toContain('Build things that mater');
    expect(body).toContain('Build things that matter');
  });

  it('falls back to the tag when there is no source file', () => {
    expect(buildIssueBody(base)).toContain('`<h1>`');
  });

  it('uses the source file when one was confirmed', () => {
    const body = buildIssueBody({
      ...base,
      edits: [{ ...base.edits[0], sourceFile: 'src/Hero.tsx', sourceLine: 12 }],
    });
    expect(body).toContain('`src/Hero.tsx:12`');
  });

  it('groups by page', () => {
    const body = buildIssueBody({
      ...base,
      edits: [
        base.edits[0],
        { originalText: 'Home', newText: 'Start', pageUrl: 'https://preview.test/pricing' },
      ],
    });
    expect(body).toContain('/pricing');
    expect(body.match(/\| Where \| Current \| Proposed \|/g)).toHaveLength(2);
  });

  it('explains why this is an issue and not a pull request', () => {
    expect(buildIssueBody(base)).toContain('no build annotation');
  });

  it('attributes the reporter and carries the note', () => {
    const body = buildIssueBody({ ...base, note: 'Spotted in review' });
    expect(body).toContain('Reported by **@octocat**');
    expect(body).toContain('Spotted in review');
  });
});

describe('attribution', () => {
  const base = {
    edits: [{ sourceFile: 'a.vue', sourceLine: 1, originalText: 'a', newText: 'b' }],
    pageUrl: 'https://acme.com/',
  };

  it('mentions a provider handle', () => {
    expect(buildPrBody({ ...base, editor: { login: 'octocat' } })).toContain('**@octocat**');
  });

  it('does not @-prefix an email address', () => {
    // Two bugs in one: it publishes the address into a body that may land in
    // a public repository, and `@ada` fires a mention at whoever owns that
    // handle on the provider.
    const body = buildPrBody({ ...base, editor: { login: 'ada@acme.com' } });
    expect(body).toContain('**ada@acme.com**');
    expect(body).not.toContain('@ada@acme.com');
  });

  it('does not @-prefix a display name', () => {
    const body = buildPrBody({ ...base, editor: { login: 'Ada Obi' } });
    expect(body).toContain('**Ada Obi**');
    expect(body).not.toContain('**@Ada Obi**');
  });

  it('omits attribution entirely when there is nobody to name', () => {
    expect(buildPrBody({ ...base, editor: {} })).not.toContain('Opened by');
    expect(buildIssueBody({ ...base, editor: {} })).not.toContain('Reported by');
  });

  it('applies the same rule to issues', () => {
    expect(buildIssueBody({ ...base, editor: { login: 'octocat' } })).toContain('**@octocat**');
    expect(buildIssueBody({ ...base, editor: { login: 'a@b.com' } })).not.toContain('@a@b.com');
  });
});

describe('plural', () => {
  it('does not say "0 change"', () => {
    expect(plural(0, 'change')).toBe('0 changes');
  });

  it('says "1 change"', () => {
    expect(plural(1, 'change')).toBe('1 change');
  });

  it('says "2 changes"', () => {
    expect(plural(2, 'change')).toBe('2 changes');
  });
});
