// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  FONT_SCALE,
  PROPERTIES,
  SPACING_SCALE,
  findUtilityClass,
  stepClass,
  usesUtilityClasses,
} from '../inline-edit-tool/extension/src/ui/class-scale.js';

/**
 * Design nudges as class changes.
 *
 * The whole point: a step has to produce a class that *exists*. Tailwind's
 * spacing scale is not linear, so arithmetic produces names like `p-13`
 * which silently do nothing on the page and look like nonsense in a pull
 * request.
 */
const step = (classes, prop, dir, prefix) => stepClass(classes.split(' ').filter(Boolean), prop, dir, prefix);

describe('findUtilityClass', () => {
  it('finds padding', () => {
    expect(findUtilityClass(['card', 'p-4'], 'padding')).toMatchObject({ prefix: 'p', value: '4' });
  });

  it('prefers the more specific side', () => {
    // `pt-8` and `p-4` can both be present; the narrower one wins on the
    // page, so it is the one to step.
    expect(findUtilityClass(['p-4', 'pt-8'], 'padding')).toMatchObject({ prefix: 'pt', value: '8' });
  });

  it('reads a negative margin', () => {
    expect(findUtilityClass(['-mt-4'], 'margin')).toMatchObject({
      prefix: 'mt',
      value: '4',
      negative: true,
    });
  });

  it('reads the unnamed middle of a scale', () => {
    // Bare `rounded` and `shadow` are real classes, sitting mid-scale.
    expect(findUtilityClass(['rounded'], 'radius')).toMatchObject({ value: '' });
    expect(findUtilityClass(['shadow'], 'shadow')).toMatchObject({ value: '' });
  });

  it('ignores responsive and state variants', () => {
    // Stepping `md:p-4` from a desktop viewport would change a breakpoint
    // the person cannot currently see.
    expect(findUtilityClass(['md:p-4'], 'padding')).toBeNull();
    expect(findUtilityClass(['hover:p-4'], 'padding')).toBeNull();
  });

  it('ignores a value that is not on the scale', () => {
    // `p-[13px]` is an arbitrary value with no next step.
    expect(findUtilityClass(['p-[13px]'], 'padding')).toBeNull();
    expect(findUtilityClass(['p-99'], 'padding')).toBeNull();
  });

  it('does not mistake one prefix for another', () => {
    expect(findUtilityClass(['px-4'], 'padding')).toMatchObject({ prefix: 'px' });
    expect(findUtilityClass(['pointer-events-none'], 'padding')).toBeNull();
    expect(findUtilityClass(['mb-4'], 'padding')).toBeNull();
  });
});

describe('stepClass — the scale is not linear', () => {
  it('steps along the real scale, never by arithmetic', () => {
    // 12 → 14, not 13. `p-13` does not exist.
    expect(step('p-12', 'padding', 1).to).toBe('p-14');
    expect(step('p-4', 'padding', 1).to).toBe('p-5');
    // And through the half-steps at the bottom.
    expect(step('p-2', 'padding', -1).to).toBe('p-1.5');
    expect(step('p-1', 'padding', -1).to).toBe('p-0.5');
  });

  it('every produced class is on the scale', () => {
    let classes = ['p-0'];
    for (let i = 0; i < SPACING_SCALE.length - 1; i++) {
      const result = stepClass(classes, 'padding', 1);
      expect(result, `ran out at ${classes.join(' ')}`).not.toBeNull();
      expect(SPACING_SCALE).toContain(result.to.replace(/^p-/, ''));
      classes = result.classes;
    }
  });

  it('refuses to step off the end rather than clamping', () => {
    // Clamping looks identical to a broken key. Returning null lets the
    // caller say "already the largest".
    expect(stepClass(['p-96'], 'padding', 1)).toBeNull();
    expect(stepClass(['p-0'], 'padding', -1)).toBeNull();
  });

  it('keeps the side it found', () => {
    expect(step('pt-4', 'padding', 1).to).toBe('pt-5');
    expect(step('px-4', 'padding', 1).to).toBe('px-5');
  });

  it('replaces the class rather than adding a second one', () => {
    const result = step('card p-4 rounded', 'padding', 1);
    expect(result.classes).toEqual(['card', 'p-5', 'rounded']);
    expect(result.classes.filter((c) => c.startsWith('p-'))).toHaveLength(1);
  });

  it('adds a class when the property is unset', () => {
    const result = step('card', 'padding', 1);
    expect(result.from).toBeNull();
    expect(result.to).toBe('p-px');
    expect(result.classes).toContain('card');
  });
});

describe('stepClass — negative margins', () => {
  it('runs the other way, because -m-4 is further out than -m-2', () => {
    expect(step('-mt-4', 'margin', 1).to).toBe('-mt-3.5');
    expect(step('-mt-4', 'margin', -1).to).toBe('-mt-5');
  });

  it('crosses zero by flipping the sign', () => {
    // Continuous adjustment through zero is what makes a margin usable.
    expect(step('mt-0', 'margin', -1).to).toBe('-mt-px');
  });

  it('does not let padding go negative', () => {
    // There is no such thing, and emitting `-p-2` would be a class that
    // does not exist.
    expect(stepClass(['p-0'], 'padding', -1)).toBeNull();
  });
});

describe('stepClass — the other scales', () => {
  it('steps font size by name', () => {
    expect(step('text-lg', 'fontSize', 1).to).toBe('text-xl');
    expect(step('text-xl', 'fontSize', 1).to).toBe('text-2xl');
    expect(step('text-base', 'fontSize', -1).to).toBe('text-sm');
  });

  it('steps weight, radius, shadow and opacity', () => {
    expect(step('font-normal', 'fontWeight', 1).to).toBe('font-medium');
    expect(step('rounded-lg', 'radius', 1).to).toBe('rounded-xl');
    expect(step('shadow-sm', 'shadow', 1).to).toBe('shadow');
    expect(step('opacity-50', 'opacity', 1).to).toBe('opacity-60');
  });

  it('steps into and out of an unnamed middle', () => {
    expect(step('rounded', 'radius', 1).to).toBe('rounded-md');
    expect(step('rounded-md', 'radius', -1).to).toBe('rounded');
  });

  it('every property declares a usable scale', () => {
    for (const [name, spec] of Object.entries(PROPERTIES)) {
      expect(spec.scale.length, name).toBeGreaterThan(1);
      expect(spec.prefixes.length, name).toBeGreaterThan(0);
      expect(spec.css, name).toBeTruthy();
    }
  });
});

describe('usesUtilityClasses', () => {
  it('recognises a utility codebase', () => {
    // Breadth across families, which is what a real Tailwind page looks
    // like. Ten divs all using `p-` is one family and no real page.
    document.body.innerHTML = `
      <div class="p-4 rounded-lg"><h2 class="text-xl font-bold">T</h2>
      <p class="m-2 text-sm">x</p></div>`;
    expect(usesUtilityClasses(document)).toBe(true);
  });

  it('is not fooled by repetition within one family', () => {
    // Ten paddings and nothing else is a page that copied one component.
    document.body.innerHTML = Array.from(
      { length: 10 },
      (_, i) => `<div class="p-${i}">x</div>`
    ).join('');
    expect(usesUtilityClasses(document)).toBe(false);
  });

  it('does not mistake an ordinary page for one', () => {
    // Stepping a class on a codebase that does not use them would add
    // markup nobody there writes — a diff a reviewer would reject.
    document.body.innerHTML =
      '<div class="card"><p class="lead">x</p><span class="muted">y</span></div>';
    expect(usesUtilityClasses(document)).toBe(false);
  });

  it('is not fooled by one or two incidental matches', () => {
    document.body.innerHTML = '<div class="w-full">x</div><p class="text-center">y</p>';
    expect(usesUtilityClasses(document)).toBe(false);
  });
});

describe('the font scale is ordered', () => {
  it('runs smallest to largest', () => {
    expect(FONT_SCALE.indexOf('sm')).toBeLessThan(FONT_SCALE.indexOf('lg'));
    expect(FONT_SCALE.indexOf('lg')).toBeLessThan(FONT_SCALE.indexOf('4xl'));
  });
});
