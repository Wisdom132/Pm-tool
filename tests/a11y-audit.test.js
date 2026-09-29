// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { accessibleName, auditElement } from '../inline-edit-tool/extension/src/ui/a11y.js';

/**
 * The audit's verdicts, on real DOM.
 *
 * Contrast is exercised in contrast.test.js and in e2e (happy-dom does not
 * compute inherited colours); what belongs here is everything else the card
 * claims — names, alt text, and the traps.
 */
beforeEach(() => {
  document.body.innerHTML = '';
});

function el(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

describe('accessibleName', () => {
  it('prefers aria-label over content', () => {
    expect(accessibleName(el('<button aria-label="Close dialog">×</button>'))).toBe('Close dialog');
  });

  it('resolves aria-labelledby through the document', () => {
    document.body.innerHTML =
      '<span id="t">Delete</span><span id="w">forever</span><button aria-labelledby="t w"></button>';
    expect(accessibleName(document.querySelector('button'))).toBe('Delete forever');
  });

  it('an image is named by its alt, not its file name', () => {
    expect(accessibleName(el('<img src="a.png" alt="The team">'))).toBe('The team');
    expect(accessibleName(el('<img src="a.png">'))).toBe('');
  });

  it('a link is named by the alt of the image inside it', () => {
    // The icon-link pattern: no text, but the img speaks for it.
    expect(accessibleName(el('<a href="/x"><img src="i.svg" alt="Settings"></a>'))).toBe('Settings');
  });

  it('collapses whitespace in text names', () => {
    expect(accessibleName(el('<a href="/x">  Read\n  more </a>'))).toBe('Read more');
  });

  it('falls back to title last', () => {
    expect(accessibleName(el('<a href="/x" title="Home"></a>'))).toBe('Home');
  });
});

describe('auditElement', () => {
  const rows = (html) => auditElement(el(html));
  const kinds = (html) => Object.fromEntries(rows(html).map((r) => [r.label, r.kind]));

  it('fails an image with no alt attribute at all', () => {
    expect(kinds('<img src="a.png">')['Alt text']).toBe('fail');
  });

  it('treats an empty alt as deliberate, not broken', () => {
    // alt="" is the HTML idiom for decorative. Flagging it as a failure
    // would teach people to fill it with noise.
    expect(kinds('<img src="a.png" alt="">')['Alt text']).toBe('info');
  });

  it('passes an image with real alt text', () => {
    const row = rows('<img src="a.png" alt="The team">').find((r) => r.label === 'Alt text');
    expect(row.kind).toBe('pass');
    expect(row.detail).toContain('The team');
  });

  it('fails a nameless button — the icon-button trap', () => {
    expect(kinds('<button><svg></svg></button>').Name).toBe('fail');
  });

  it('passes a button a screen reader can announce', () => {
    expect(kinds('<button>Save changes</button>').Name).toBe('pass');
  });

  it('warns on a link going nowhere', () => {
    expect(kinds('<a href="#">Click here</a>').Link).toBe('warn');
    expect(kinds('<a>Click here</a>').Link).toBe('warn');
    expect(kinds('<a href="/pricing">Pricing</a>').Link).toBeUndefined();
  });

  it('warns on aria-hidden, naming what it swallows', () => {
    const row = rows('<div aria-hidden="true">Everything in here</div>').find(
      (r) => r.label === 'aria-hidden'
    );
    expect(row.kind).toBe('warn');
    expect(row.detail.toLowerCase()).toContain('inside');
  });

  it('warns on a positive tabindex and not on the legitimate values', () => {
    expect(kinds('<div tabindex="3">x</div>').tabindex).toBe('warn');
    expect(kinds('<div tabindex="0">x</div>').tabindex).toBeUndefined();
    expect(kinds('<div tabindex="-1">x</div>').tabindex).toBeUndefined();
  });

  it('orders failures first — the thing to act on is the first line read', () => {
    const result = rows('<a href="#"><img src="i.png"></a>');
    expect(result[0].kind).toBe('fail');
    const order = { fail: 0, warn: 1, pass: 2, info: 3 };
    const ranks = result.map((r) => order[r.kind]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('says so when there is nothing to check', () => {
    const result = auditElement(el('<div><p>child text, not direct</p></div>'));
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('info');
  });

  it('audits an input button by its value', () => {
    expect(kinds('<input type="submit" value="Send">').Name).toBe('pass');
    expect(kinds('<input type="submit" value="">').Name).toBe('fail');
  });
});
