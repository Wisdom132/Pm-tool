import { describe, it, expect } from 'vitest';
import vuePlugin from '../annotation/vue/index.js';

const { findTemplateContentOffset } = vuePlugin;

describe('findTemplateContentOffset', () => {
  it('returns the offset just past a bare <template>', () => {
    const code = '<template>\n  <p>Hi</p>\n</template>';
    expect(findTemplateContentOffset(code, 0)).toBe('<template>'.length);
  });

  it('handles attributes on the template tag', () => {
    const code = '<template lang="html">\n  <p>Hi</p>\n</template>';
    expect(findTemplateContentOffset(code, 0)).toBe('<template lang="html">'.length);
  });

  it('is not fooled by > inside a double-quoted attribute', () => {
    const open = '<template data-x="a > b">';
    expect(findTemplateContentOffset(open + '\n<p>Hi</p>', 0)).toBe(open.length);
  });

  it('is not fooled by > inside a single-quoted attribute', () => {
    const open = "<template data-x='a > b'>";
    expect(findTemplateContentOffset(open + '\n<p>Hi</p>', 0)).toBe(open.length);
  });

  it('respects a non-zero start offset', () => {
    const prefix = '<script setup>const a = 1;</script>\n';
    const code = prefix + '<template>\n  <p>Hi</p>\n</template>';
    expect(findTemplateContentOffset(code, prefix.length)).toBe(
      prefix.length + '<template>'.length
    );
  });

  it('falls back to the start offset when the tag is never closed', () => {
    const code = '<template lang="html"';
    expect(findTemplateContentOffset(code, 0)).toBe(0);
  });

  it('points at content that begins exactly where the tag ends', () => {
    const code = '<template>HELLO</template>';
    const offset = findTemplateContentOffset(code, 0);
    expect(code.slice(offset, offset + 5)).toBe('HELLO');
  });
});
