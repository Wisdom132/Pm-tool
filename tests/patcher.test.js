import { describe, it, expect } from 'vitest';
import { buildCommitMessage, buildPrBody } from '../overlay/pr-service/lib/patcher.js';

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
