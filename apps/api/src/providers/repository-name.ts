import { ProviderError } from './provider.types';

/**
 * Split `owner/repo`.
 *
 * Its own file, with no Nest imports, because it is the one piece of string
 * handling between a user-supplied site registration and a URL we call with
 * write credentials — and that deserves to be unit-testable on its own.
 *
 * A repository of `owner/../../other` must not become a request to another
 * repository, and `owner/repo?ref=x` must not become a query parameter.
 */
export function splitRepository(repository: string): { owner: string; repo: string } {
  const reject = () =>
    new ProviderError(
      `"${repository}" is not a repository name. Expected owner/name, for example acme/website.`,
      'not-found',
    );

  const parts = String(repository ?? '').trim().split('/');
  if (parts.length !== 2) throw reject();

  const [owner, repo] = parts;

  // An allowlist, not a denylist. GitHub, GitLab and Bitbucket all restrict
  // names to this set, so anything else is either a typo or an attempt to
  // reach outside the path.
  const allowed = /^[A-Za-z0-9._-]+$/;
  if (!allowed.test(owner) || !allowed.test(repo)) throw reject();

  // `.` and `..` pass the character check and are exactly the two that
  // traverse. `.git` is rejected because a repo cannot be named that and it
  // is a common probe.
  const traversal = new Set(['.', '..', '.git']);
  if (traversal.has(owner) || traversal.has(repo.toLowerCase())) throw reject();

  return { owner, repo };
}
