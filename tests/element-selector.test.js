// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectorFor,
  commentTargetFrom,
  annotationFor,
} from '../inline-edit-tool/extension/src/element-selector.js';

const html = (markup) => {
  document.body.innerHTML = markup;
  return document.body;
};

describe('selectorFor', () => {
  it('uses a stable id and stops there', () => {
    html('<div class="wrap"><p id="tagline">Hi</p></div>');
    expect(selectorFor(document.getElementById('tagline'))).toBe('#tagline');
  });

  it('prefers a stable class over position', () => {
    html('<section><h1 class="hero-title">Hi</h1></section>');
    expect(selectorFor(document.querySelector('h1'))).toBe('section > h1.hero-title');
  });

  it('falls back to nth-of-type among siblings', () => {
    html('<ul><li>a</li><li>b</li><li>c</li></ul>');
    expect(selectorFor(document.querySelectorAll('li')[1])).toBe('ul > li:nth-of-type(2)');
  });

  it('omits nth-of-type when the element is the only one of its tag', () => {
    html('<div><span>only</span></div>');
    expect(selectorFor(document.querySelector('span'))).toBe('div > span');
  });
});

describe('selectorFor — what it refuses to rely on', () => {
  // A generated class is worse than useless: it looks precise and stops
  // matching at the next build.
  const generated = [
    ['hashed', '<div><p class="header-1a2b3c">x</p></div>'],
    ['styled-components', '<div><p class="sc-aXZVg">x</p></div>'],
    ['css module local', '<div><p class="_hero_1x2y3">x</p></div>'],
    ['bare hash', '<div><p class="9f8e7d6c">x</p></div>'],
    ['svelte scope', '<div><p class="svelte-1a2b3c">x</p></div>'],
  ];

  it.each(generated)('ignores a %s class', (_name, markup) => {
    html(markup);
    expect(selectorFor(document.querySelector('p'))).toBe('div > p');
  });

  it('ignores a generated id too', () => {
    html('<div><p id="a1b2c3d4e5">x</p></div>');
    expect(selectorFor(document.querySelector('p'))).toBe('div > p');
  });

  it('ignores interaction state that flips as the user clicks', () => {
    html('<nav><a class="is-active">x</a></nav>');
    expect(selectorFor(document.querySelector('a'))).toBe('nav > a');
  });
});

describe('selectorFor — the selectors actually work', () => {
  // The point of the whole module: what it returns must re-find the element.
  const cases = [
    '<div class="wrap"><p id="tagline">Hi</p></div>',
    '<section><h1 class="hero-title">Hi</h1></section>',
    '<ul><li>a</li><li>b</li><li>c</li></ul>',
    '<main><div class="col"><div class="col"><span>deep</span></div></div></main>',
    '<div><p class="header-1a2b3c">generated</p></div>',
  ];

  it.each(cases)('round-trips %s', (markup) => {
    html(markup);
    for (const el of document.body.querySelectorAll('*')) {
      const selector = selectorFor(el);
      expect(selector, `empty selector for ${el.tagName}`).not.toBe('');
      // Matching more than one element is acceptable; matching none is not.
      const found = document.body.querySelectorAll(selector);
      expect(found.length, `${selector} matched nothing`).toBeGreaterThan(0);
    }
  });
});

describe('selectorFor — edges', () => {
  it('stops at four levels rather than emitting a brittle full path', () => {
    html('<a><b><c><d><e><f><span>deep</span></f></e></d></c></b></a>');
    const selector = selectorFor(document.querySelector('span'));
    expect(selector.split(' > ').length).toBeLessThanOrEqual(4);
  });

  it('returns nothing for a non-element', () => {
    expect(selectorFor(null)).toBe('');
    expect(selectorFor(document.createTextNode('x'))).toBe('');
  });
});

describe('commentTargetFrom', () => {
  // The editing tools are limited to what the codemod can change. Comment is
  // not — you comment on what you can see.
  const anything = [
    ['an image', '<img src="/hero.webp" alt="Laundry" />', 'img'],
    ['an icon', '<svg><path d="M0 0"/></svg>', 'svg'],
    ['a button with no text', '<button aria-label="Close"></button>', 'button'],
    ['a decorative wrapper', '<div class="bg"></div>', 'div'],
    ['a form field', '<input placeholder="Email" />', 'input'],
    ['a video', '<video src="/clip.mp4"></video>', 'video'],
  ];

  it.each(anything)('targets %s', (_name, markup, tag) => {
    html(`<section>${markup}</section>`);
    const el = document.querySelector(tag);
    expect(commentTargetFrom(el, document)).toBe(el);
  });

  it('refuses the document and the body', () => {
    // A comment on the whole page is a comment on nothing in particular,
    // and outlining the viewport looks like a bug.
    html('<p>x</p>');
    expect(commentTargetFrom(document.documentElement, document)).toBeNull();
    expect(commentTargetFrom(document.body, document)).toBeNull();
  });

  it('refuses anything that is not an element', () => {
    html('<p>x</p>');
    expect(commentTargetFrom(null, document)).toBeNull();
    expect(commentTargetFrom(document.createTextNode('x'), document)).toBeNull();
    expect(commentTargetFrom(document, document)).toBeNull();
  });

  it('takes the deepest element, not an ancestor', () => {
    // The browser hands us what is under the cursor; narrowing to a
    // container would comment on the wrong thing.
    html('<figure><img src="/a.webp" alt="a" /><figcaption>Caption</figcaption></figure>');
    const img = document.querySelector('img');
    expect(commentTargetFrom(img, document)).toBe(img);
  });
});

describe('annotationFor', () => {
  it('uses the element\'s own annotation when it has one', () => {
    html('<h1 data-edit-file="home-hero.vue" data-edit-line="6">Focus</h1>');
    expect(annotationFor(document.querySelector('h1'))).toEqual({
      sourceFile: 'home-hero.vue',
      sourceLine: 6,
      exact: true,
    });
  });

  it('falls back to the nearest annotated ancestor', () => {
    // The annotation plugin stamps elements holding *text*, so an image
    // never carries one — but the component around it does, and "somewhere
    // in home-hero.vue" is far more use than nothing.
    html(`
      <section data-edit-file="home-hero.vue" data-edit-line="6">
        <img src="/hero.webp" alt="Laundry" />
      </section>
    `);
    expect(annotationFor(document.querySelector('img'))).toEqual({
      sourceFile: 'home-hero.vue',
      sourceLine: 6,
      exact: false,
    });
  });

  it('marks an inherited annotation as inexact', () => {
    // The composer says "Inside" rather than "Pinned to" for these, so the
    // line is not claimed to be the image's own.
    html('<div data-edit-file="a.vue" data-edit-line="2"><button></button></div>');
    expect(annotationFor(document.querySelector('button')).exact).toBe(false);
  });

  it('takes the *nearest* ancestor, not the outermost', () => {
    html(`
      <section data-edit-file="page.vue" data-edit-line="1">
        <div data-edit-file="card.vue" data-edit-line="9">
          <img src="/a.webp" />
        </div>
      </section>
    `);
    expect(annotationFor(document.querySelector('img')).sourceFile).toBe('card.vue');
  });

  it('reports nothing on an unannotated page', () => {
    html('<div><img src="/a.webp" /></div>');
    expect(annotationFor(document.querySelector('img'))).toEqual({
      sourceFile: null,
      sourceLine: null,
      exact: false,
    });
  });

  it('copes with an annotation that has no line', () => {
    html('<div data-edit-file="a.vue"><img src="/a.webp" /></div>');
    expect(annotationFor(document.querySelector('img'))).toEqual({
      sourceFile: 'a.vue',
      sourceLine: null,
      exact: false,
    });
  });

  it('returns nothing for a non-element', () => {
    html('<p>x</p>');
    expect(annotationFor(null).sourceFile).toBeNull();
    expect(annotationFor(document.createTextNode('x')).sourceFile).toBeNull();
  });
});
