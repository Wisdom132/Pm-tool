import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SERVICE_URL,
  validateServiceUrl,
  resolveServiceUrl,
  isLoopback,
} from '../inline-edit-tool/extension/src/config.js';

describe('validateServiceUrl', () => {
  it('accepts an https URL', () => {
    expect(validateServiceUrl('https://prs.acme.com')).toEqual({
      ok: true,
      url: 'https://prs.acme.com',
    });
  });

  it('accepts http on localhost', () => {
    expect(validateServiceUrl('http://localhost:3001').ok).toBe(true);
    expect(validateServiceUrl('http://127.0.0.1:3001').ok).toBe(true);
  });

  it('rejects http on a remote host', () => {
    // The extension sends a bearer token to this origin on every request.
    const result = validateServiceUrl('http://prs.acme.com');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/https/);
  });

  it('rejects a non-http protocol', () => {
    expect(validateServiceUrl('ftp://prs.acme.com').ok).toBe(false);
    expect(validateServiceUrl('javascript:alert(1)').ok).toBe(false);
  });

  it('rejects unparseable input', () => {
    expect(validateServiceUrl('not a url').ok).toBe(false);
  });

  it('rejects empty input', () => {
    expect(validateServiceUrl('').ok).toBe(false);
    expect(validateServiceUrl(undefined).ok).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(validateServiceUrl('  https://prs.acme.com  ').url).toBe('https://prs.acme.com');
  });

  it('strips a trailing slash', () => {
    expect(validateServiceUrl('https://prs.acme.com/').url).toBe('https://prs.acme.com');
  });

  it('preserves a path prefix', () => {
    expect(validateServiceUrl('https://acme.com/pr-service/').url).toBe(
      'https://acme.com/pr-service'
    );
  });

  it('drops query strings and fragments', () => {
    expect(validateServiceUrl('https://prs.acme.com/?a=1#x').url).toBe('https://prs.acme.com');
  });
});

describe('resolveServiceUrl', () => {
  it('returns a valid stored URL', () => {
    expect(resolveServiceUrl('https://prs.acme.com')).toBe('https://prs.acme.com');
  });

  it('falls back to the default for anything invalid', () => {
    expect(resolveServiceUrl('')).toBe(DEFAULT_SERVICE_URL);
    expect(resolveServiceUrl(undefined)).toBe(DEFAULT_SERVICE_URL);
    expect(resolveServiceUrl('http://evil.com')).toBe(DEFAULT_SERVICE_URL);
  });

  it('normalises as it resolves', () => {
    expect(resolveServiceUrl('https://prs.acme.com/')).toBe('https://prs.acme.com');
  });
});

describe('isLoopback', () => {
  it('recognises loopback hosts', () => {
    expect(isLoopback('localhost')).toBe(true);
    expect(isLoopback('127.0.0.1')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isLoopback('acme.com')).toBe(false);
    expect(isLoopback('localhost.evil.com')).toBe(false);
  });
});
