// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { createInspectorCard } from '../inline-edit-tool/extension/src/ui/labels.js';

/**
 * What the Inspect card says.
 *
 * It used to show five rows, all of which are empty for an image: source
 * file, line, framework, translation key, text. So inspecting an image
 * produced a blank card — on top of the tool not targeting images at all.
 */
const mount = (markup) => {
  document.body.innerHTML = markup;
  return document.querySelector('[data-probe]');
};

let card;
let root;

beforeEach(() => {
  card = createInspectorCard();
  root = card.element;
});

const rows = () => {
  const out = {};
  const list = root.querySelector('dl');
  if (!list) return out;
  const children = [...list.children];
  for (let i = 0; i < children.length; i += 2) {
    out[children[i].textContent] = children[i + 1]?.textContent;
  }
  return out;
};

describe('an annotated text element', () => {
  it('shows its own source file and line', () => {
    const el = mount('<h1 data-probe data-edit-file="home-hero.vue" data-edit-line="6">Focus</h1>');
    card.show(el);
    expect(rows()['Source file']).toBe('home-hero.vue');
    expect(rows()['Line']).toBe('6');
    expect(rows()['Text']).toBe('Focus');
  });
});

describe('an image', () => {
  it('is no longer a blank card', () => {
    const el = mount('<img data-probe src="/img/hero-laundry.webp" alt="Laundry on a line" />');
    card.show(el);
    expect(Object.keys(rows()).length).toBeGreaterThan(0);
  });

  it('names its source, without the query string', () => {
    const el = mount('<img data-probe src="/_nuxt/hero.webp?v=2" alt="x" />');
    card.show(el);
    expect(rows()['Source']).toBe('/_nuxt/hero.webp');
  });

  it('shows alt text, and says when it is deliberately empty', () => {
    card.show(mount('<img data-probe src="/a.webp" alt="Laundry on a line" />'));
    expect(rows()['Alt text']).toBe('Laundry on a line');

    card.show(mount('<img data-probe src="/a.webp" alt="" />'));
    expect(rows()['Alt text']).toBe('(empty — decorative)');
  });

  it('does not print a data URI in full', () => {
    const el = mount('<img data-probe src="data:image/png;base64,iVBORw0KGgo=" alt="x" />');
    card.show(el);
    expect(rows()['Source']).toBe('inline data URI');
  });

  it('reports the component that drew it, from the nearest annotation', () => {
    // The whole point: an image is never annotated itself, so without this
    // there is nothing to tell you which file to open.
    const el = mount(`
      <section data-edit-file="home-hero.vue" data-edit-line="6">
        <img data-probe src="/a.webp" alt="x" />
      </section>
    `);
    card.show(el);
    expect(rows()['Rendered in']).toBe('home-hero.vue');
    expect(rows()['Source file']).toBeUndefined();
  });

  it('says the line is the ancestor\'s, not the image\'s', () => {
    const el = mount(`
      <section data-edit-file="home-hero.vue" data-edit-line="6">
        <img data-probe src="/a.webp" alt="x" />
      </section>
    `);
    card.show(el);
    expect(root.querySelector('p')?.textContent).toMatch(/nearest annotated ancestor/);
  });
});

describe('an unannotated element with no text', () => {
  it('does not promise a repository search that cannot happen', () => {
    // The old note said the service would "search the repository for this
    // text". There is no text on an icon, so that was simply untrue.
    const el = mount('<svg data-probe><path d="M0 0"/></svg>');
    card.show(el);
    const note = root.querySelector('p')?.textContent ?? '';
    expect(note).toMatch(/no text to search for/);
    expect(note).not.toMatch(/search the repository for this text/);
  });

  it('still offers the search note when there is text', () => {
    const el = mount('<p data-probe>Some copy nobody annotated</p>');
    card.show(el);
    expect(root.querySelector('p')?.textContent).toMatch(/search the repository for this text/);
  });
});
