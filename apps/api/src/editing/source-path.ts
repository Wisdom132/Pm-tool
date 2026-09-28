/**
 * Validating a repository-relative file path.
 *
 * Every path here arrives from a `data-edit-file` attribute on a page we do
 * not control, so it is untrusted input that is about to be interpolated
 * into a provider API call made with write credentials.
 *
 * The old service checked `path.includes('..')` and a leading slash. That
 * misses percent-encoding (`%2e%2e%2f`), backslashes on a provider that
 * normalises them, and a path that is entirely benign-looking but absolute
 * on Windows (`C:\`). It also rejected legitimate filenames containing `..`
 * — rare, but `foo..bar.ts` is a valid name.
 *
 * This is an allowlist of segments instead: every segment must be a plain
 * name, and `.` and `..` are rejected as whole segments rather than as
 * substrings.
 */

export class InvalidSourcePath extends Error {
  constructor(readonly path: string, reason: string) {
    super(`"${path}" is not a valid source path: ${reason}`);
    this.name = 'InvalidSourcePath';
  }
}

/** Anything a git tree can hold, minus the characters used to traverse. */
const SEGMENT = /^[A-Za-z0-9._@()[\]{}+,'!$&=~ -]+$/;

const MAX_LENGTH = 400;
const MAX_DEPTH = 32;

/**
 * @returns the path, unchanged, when it is safe to use.
 * @throws InvalidSourcePath otherwise.
 */
export function assertSourcePath(path: unknown): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new InvalidSourcePath(String(path), 'it is empty');
  }
  if (path.length > MAX_LENGTH) {
    throw new InvalidSourcePath(path, `it is longer than ${MAX_LENGTH} characters`);
  }

  // Decoded first: a provider that accepts `%2e%2e` would otherwise see a
  // traversal this function had already approved.
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new InvalidSourcePath(path, 'it is not valid percent-encoding');
  }
  if (decoded !== path) {
    throw new InvalidSourcePath(path, 'it is percent-encoded; send the plain path');
  }

  if (path.startsWith('/') || path.startsWith('\\')) {
    throw new InvalidSourcePath(path, 'it must be relative to the repository root');
  }
  if (/^[A-Za-z]:/.test(path)) {
    throw new InvalidSourcePath(path, 'it is an absolute Windows path');
  }
  if (path.includes('\\')) {
    throw new InvalidSourcePath(path, 'use forward slashes');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new InvalidSourcePath(path, 'it contains control characters');
  }

  const segments = path.split('/');
  if (segments.length > MAX_DEPTH) {
    throw new InvalidSourcePath(path, `it is more than ${MAX_DEPTH} directories deep`);
  }

  for (const segment of segments) {
    if (segment === '') {
      throw new InvalidSourcePath(path, 'it has an empty path segment');
    }
    if (segment === '.' || segment === '..') {
      throw new InvalidSourcePath(path, 'it traverses outside the repository');
    }
    if (segment === '.git') {
      throw new InvalidSourcePath(path, 'it points inside the git directory');
    }
    if (!SEGMENT.test(segment)) {
      throw new InvalidSourcePath(path, `"${segment}" is not a valid file or directory name`);
    }
  }

  return path;
}

/** The non-throwing form, for filtering a batch. */
export function isSourcePath(path: unknown): boolean {
  try {
    assertSourcePath(path);
    return true;
  } catch {
    return false;
  }
}
