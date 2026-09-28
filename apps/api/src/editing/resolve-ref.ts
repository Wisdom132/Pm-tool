/**
 * Which ref an editing request actually operates on.
 *
 * Its own file because it is a security rule, and because the rule is
 * asymmetric in a way that is easy to get wrong in either direction — I got
 * it wrong in the restrictive direction first.
 *
 * **A write pins to the registered branch.** Otherwise a page could name a
 * branch its editors were never pointed at, and the site registry would
 * stop meaning anything. The caller's ref is honoured only when the
 * environment has no branch of its own — the preview-deploy case, where the
 * branch genuinely is per-deployment and comes from the URL or the build.
 *
 * **A read may name any ref.** The entire point of the build annotation is
 * to read the file at the exact commit the editor is looking at. Pinning
 * reads to the branch tip shows them a file they are not looking at, which
 * is the failure the staleness machinery exists to prevent. It grants
 * nothing extra either: provider access is granted per repository, not per
 * branch, so any ref of this repository was already readable.
 */

export type Mode = 'read' | 'write';

export interface RefRequest {
  mode: Mode;
  /** The branch the site is registered against. Null for preview deploys. */
  environmentBranch: string | null;
  /** What the caller asked for, if anything. */
  requested?: string | null;
}

/**
 * @returns the ref to use, or null when there is nothing to fall back on —
 *          a preview-deploy environment whose caller sent no branch.
 */
export function resolveRef({ mode, environmentBranch, requested }: RefRequest): string | null {
  const asked = requested?.trim() || null;
  const registered = environmentBranch?.trim() || null;

  return mode === 'write' ? (registered ?? asked) : (asked ?? registered);
}
