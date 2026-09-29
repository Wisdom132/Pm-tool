import { describe, it, expect } from 'vitest';
import {
  MAX_SCREENSHOT_BYTES,
  ScreenshotRejected,
  clientIp,
  decodeScreenshot,
  hashIp,
  readUserAgent,
  urlMatchesHostname,
} from '../apps/api/src/feedback/intake';

/** A real PNG header, then padding, as a data URL. */
function pngDataUrl(totalBytes = 64, type = 'image/png') {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(Math.max(0, totalBytes - header.length), 0x00);
  return `data:${type};base64,${Buffer.concat([header, body]).toString('base64')}`;
}

function jpegDataUrl(type = 'image/jpeg') {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]);
  return `data:${type};base64,${bytes.toString('base64')}`;
}

function webpDataUrl() {
  const bytes = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('WEBP', 'ascii'),
    Buffer.alloc(16),
  ]);
  return `data:image/webp;base64,${bytes.toString('base64')}`;
}

describe('decodeScreenshot', () => {
  it('accepts a PNG', () => {
    const { bytes, type } = decodeScreenshot(pngDataUrl());
    expect(type).toBe('image/png');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(64);
  });

  it('accepts a JPEG and a WebP', () => {
    expect(decodeScreenshot(jpegDataUrl()).type).toBe('image/jpeg');
    expect(decodeScreenshot(webpDataUrl()).type).toBe('image/webp');
  });

  it('refuses anything that is not a data URL', () => {
    expect(() => decodeScreenshot('https://example.com/a.png')).toThrow(ScreenshotRejected);
    expect(() => decodeScreenshot('')).toThrow(ScreenshotRejected);
  });

  it('refuses a type we would not render', () => {
    // An SVG is a document: it executes script when rendered, and serving
    // one back from our own origin is a stored cross-site scripting hole.
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
    expect(() => decodeScreenshot(svg)).toThrow(/not an accepted image type/);
  });

  it('refuses bytes that do not match the declared type', () => {
    // The declared type is attacker-controlled. Believing it is how an
    // upload endpoint becomes a way to host arbitrary content on our origin.
    const lying = `data:image/png;base64,${Buffer.from('not an image at all').toString('base64')}`;
    expect(() => decodeScreenshot(lying)).toThrow(ScreenshotRejected);
  });

  it('refuses a JPEG wearing a PNG label', () => {
    expect(() => decodeScreenshot(jpegDataUrl('image/png'))).toThrow(/does not match/);
  });

  it('refuses RIFF that is not WEBP', () => {
    const riff = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('AVI ', 'ascii'),
      Buffer.alloc(16),
    ]);
    const url = `data:image/webp;base64,${riff.toString('base64')}`;
    expect(() => decodeScreenshot(url)).toThrow(ScreenshotRejected);
  });

  it('refuses an empty image', () => {
    expect(() => decodeScreenshot('data:image/png;base64,')).toThrow(ScreenshotRejected);
  });

  it('refuses one over the cap', () => {
    expect(() => decodeScreenshot(pngDataUrl(MAX_SCREENSHOT_BYTES + 1))).toThrow(/too large/);
  });

  it('accepts one exactly at the cap', () => {
    expect(decodeScreenshot(pngDataUrl(MAX_SCREENSHOT_BYTES)).bytes.length).toBe(
      MAX_SCREENSHOT_BYTES,
    );
  });

  it('checks the encoded length before allocating', () => {
    // A 40MB base64 payload must be refused without Buffer.from ever being
    // asked to materialise it — that allocation *is* the denial of service.
    const huge = `data:image/png;base64,${'A'.repeat(40 * 1024 * 1024)}`;
    expect(() => decodeScreenshot(huge)).toThrow(/too large/);
  });
});

describe('hashIp', () => {
  it('is stable for the same address', () => {
    expect(hashIp('203.0.113.4', 's')).toBe(hashIp('203.0.113.4', 's'));
  });

  it('differs between addresses', () => {
    expect(hashIp('203.0.113.4', 's')).not.toBe(hashIp('203.0.113.5', 's'));
  });

  it('is salted, so it cannot be reversed from a rainbow table', () => {
    // There are only four billion IPv4 addresses. An unsalted hash of one
    // is reversible by brute force in seconds.
    expect(hashIp('203.0.113.4', 'one')).not.toBe(hashIp('203.0.113.4', 'two'));
  });

  it('does not contain the address', () => {
    expect(hashIp('203.0.113.4', 's')).not.toContain('203.0.113');
  });
});

describe('clientIp', () => {
  it('reads the first forwarded address when the proxy is trusted', () => {
    const ip = clientIp({ 'x-forwarded-for': '203.0.113.4, 10.0.0.1' }, '10.0.0.1', true);
    expect(ip).toBe('203.0.113.4');
  });

  it('ignores the header when the proxy is not trusted', () => {
    // Read unconditionally, every rate limit keyed on it is bypassable by
    // sending a different value on each request.
    const ip = clientIp({ 'x-forwarded-for': '1.2.3.4' }, '10.0.0.1', false);
    expect(ip).toBe('10.0.0.1');
  });

  it('falls back to the socket when the header is absent', () => {
    expect(clientIp({}, '10.0.0.1', true)).toBe('10.0.0.1');
  });

  it('never returns empty, so a bucket key is always well formed', () => {
    expect(clientIp({}, undefined, true)).toBe('unknown');
    expect(clientIp({ 'x-forwarded-for': '  ' }, undefined, true)).toBe('unknown');
  });

  it('handles a repeated header', () => {
    expect(clientIp({ 'x-forwarded-for': ['203.0.113.4', '5.6.7.8'] }, '10.0.0.1', true)).toBe(
      '203.0.113.4',
    );
  });
});

describe('readUserAgent', () => {
  it('reads the header', () => {
    expect(readUserAgent({ 'user-agent': 'Mozilla/5.0' })).toBe('Mozilla/5.0');
  });

  it('is null when absent or blank', () => {
    expect(readUserAgent({})).toBeNull();
    expect(readUserAgent({ 'user-agent': '   ' })).toBeNull();
  });

  it('truncates, so the column cannot be used as free storage', () => {
    expect(readUserAgent({ 'user-agent': 'x'.repeat(5000) })).toHaveLength(400);
  });
});

describe('urlMatchesHostname', () => {
  it('accepts the page it claims to be on', () => {
    expect(urlMatchesHostname('https://acme.com/pricing', 'acme.com')).toBe(true);
  });

  it('refuses a different host', () => {
    // Otherwise a comment filed against a registered site can name any URL,
    // and the inbox shows a link with nothing to do with that site.
    expect(urlMatchesHostname('https://evil.com/x', 'acme.com')).toBe(false);
  });

  it('refuses a host that merely ends with the same text', () => {
    expect(urlMatchesHostname('https://notacme.com/x', 'acme.com')).toBe(false);
    expect(urlMatchesHostname('https://acme.com.evil.com/x', 'acme.com')).toBe(false);
  });

  it('matches one wildcard label, like the site registry', () => {
    expect(urlMatchesHostname('https://pr-7.acme.dev/x', '*.acme.dev')).toBe(true);
    expect(urlMatchesHostname('https://a.b.acme.dev/x', '*.acme.dev')).toBe(false);
    expect(urlMatchesHostname('https://acme.dev/x', '*.acme.dev')).toBe(false);
  });

  it('is case insensitive, because hostnames are', () => {
    expect(urlMatchesHostname('https://ACME.com/x', 'acme.com')).toBe(true);
  });

  it('refuses a scheme we would not link to', () => {
    // This URL is rendered as a link in the dashboard and in the issue body.
    expect(urlMatchesHostname('javascript:alert(1)//acme.com', 'acme.com')).toBe(false);
    expect(urlMatchesHostname('data:text/html,<script>', 'acme.com')).toBe(false);
  });

  it('refuses a malformed URL', () => {
    expect(urlMatchesHostname('not a url', 'acme.com')).toBe(false);
  });

  it('ignores port and path', () => {
    expect(urlMatchesHostname('http://acme.com:8080/a/b?c=d#e', 'acme.com')).toBe(true);
  });
});
