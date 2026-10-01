import { describe, it, expect } from 'vitest';
import {
  FEATURE_SINCE,
  compareVersions,
  outdatedHint,
  pluginSupports,
} from '../inline-edit-tool/extension/src/plugin-version.js';

/**
 * Version skew between the two halves.
 *
 * The extension auto-updates; the build plugin moves only when somebody runs
 * `npm update` and redeploys. So the extension is almost always newer, and
 * the rule from CONTRACT.md is that it must keep working against every
 * attribute set the plugin has ever emitted — the version explains a gap, it
 * never gates behaviour.
 */
describe('compareVersions', () => {
  it('orders by each part, not lexically', () => {
    // '10' < '9' as strings. This is the bug every naive comparison has.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
  });

  it('treats equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('pads missing parts with zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
  });

  it('ignores a prerelease suffix rather than choking on it', () => {
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(0);
  });

  it('survives rubbish, because this comes off a page we do not control', () => {
    expect(() => compareVersions(null, '1.0.0')).not.toThrow();
    expect(() => compareVersions('not-a-version', '1.0.0')).not.toThrow();
  });
});

describe('pluginSupports', () => {
  it('allows a feature at exactly the version that introduced it', () => {
    expect(pluginSupports(FEATURE_SINCE.i18n, 'i18n')).toBe(true);
  });

  it('refuses it below that', () => {
    expect(pluginSupports('0.9.0', 'i18n')).toBe(false);
  });

  it('assumes support when the page reports no version', () => {
    // A page built before `data-edit-version` existed. Guessing "supported"
    // costs a hint nobody needed; guessing the other way tells somebody
    // their plugin is too old when it is fine, and sends them to update
    // something that was never the problem.
    expect(pluginSupports(null, 'i18n')).toBe(true);
    expect(pluginSupports('', 'i18n')).toBe(true);
  });

  it('assumes support for a feature it has never heard of', () => {
    // A *newer* plugin than this extension knows about. The plugin is ahead;
    // refusing here would break a page that works.
    expect(pluginSupports('9.0.0', 'something-new')).toBe(true);
  });
});

describe('outdatedHint', () => {
  it('names the version the page has and the one it needs', () => {
    const hint = outdatedHint('0.9.0', 'i18n');
    expect(hint).toContain('0.9.0');
    expect(hint).toContain(FEATURE_SINCE.i18n);
  });

  it('names the fix, because "not supported" is a dead end', () => {
    expect(outdatedHint('0.9.0', 'i18n')).toMatch(/npm update/);
  });

  it('says nothing when there is nothing to say', () => {
    expect(outdatedHint('1.0.0', 'i18n')).toBeNull();
    expect(outdatedHint(null, 'i18n')).toBeNull();
  });
});

describe('the contract it is enforcing', () => {
  it('every known feature names a real version', () => {
    for (const [feature, since] of Object.entries(FEATURE_SINCE)) {
      expect(since, feature).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('nothing here gates on the extension being newer', () => {
    // CONTRACT.md rule 2: feature-detect, never version-gate. A page built
    // by a plugin *newer* than this extension must keep working in full.
    for (const feature of Object.keys(FEATURE_SINCE)) {
      expect(pluginSupports('999.0.0', feature), feature).toBe(true);
    }
  });
});
