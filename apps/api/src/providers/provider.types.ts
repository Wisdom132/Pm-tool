/**
 * What the product needs from a git host.
 *
 * Derived from the operations the existing service actually performs, not
 * from what any one provider offers: eleven calls in `lib/github.js`, code
 * search in `lib/locate-source.js`, and issue creation in `create-issue.js`.
 * Nothing here is aspirational — every method has a caller today.
 *
 * Two naming choices carry the design:
 *
 *   changeRequest  GitHub calls it a pull request, GitLab a merge request.
 *                  The interface uses neither, so adding GitLab does not mean
 *                  renaming a field the extension already depends on.
 *   ref            A branch name, a tag, or a commit SHA. Reads take a ref
 *                  because a preview page is built from a *commit*, and
 *                  reading the branch tip instead would show source the user
 *                  is not looking at.
 *
 * A provider instance is bound to one repository. Resolving `owner/repo` is
 * the factory's job, so the string-splitting that is currently repeated in
 * every route happens once.
 */

export type ProviderKind = 'github' | 'gitlab' | 'bitbucket';

export interface FileContents {
  content: string;
  /**
   * Whatever the provider needs to accept a conditional write — a git blob
   * SHA on GitHub, a `last_commit_id` on GitLab. Opaque to callers, and it is
   * what stops two editors silently overwriting each other.
   */
  revision: string;
}

export interface ChangeRequest {
  url: string;
  number: number;
}

export interface Issue {
  url: string;
  number: number;
}

export interface Repository {
  fullName: string;
  private: boolean;
}

/**
 * How a preview's build commit relates to the branch we would commit to.
 *
 * `usable` is the only field most callers want: it is false exactly when
 * branching from the build commit would produce a diff against work that no
 * longer exists on the branch.
 */
export interface CommitComparison {
  status: 'identical' | 'ahead' | 'behind' | 'diverged' | 'unknown';
  /** Commits added to the branch since the build. */
  aheadBy: number;
  usable: boolean;
  tipRevision: string;
}

export interface SearchHit {
  path: string;
}

export interface CommitTextOptions {
  path: string;
  branch: string;
  content: string;
  message: string;
  /**
   * The revision the edit was based on. Omitted only when creating a file.
   * Passing a stale one must fail rather than overwrite.
   */
  revision?: string;
}

export interface CommitBinaryOptions {
  path: string;
  branch: string;
  /** Already base64. Kept separate from text so it is never re-encoded. */
  base64: string;
  message: string;
}

export interface OpenChangeRequestOptions {
  title: string;
  body: string;
  /** The branch carrying the edit. */
  head: string;
  /** The branch it should merge into. */
  base: string;
}

export interface OpenIssueOptions {
  title: string;
  body: string;
  labels?: string[];
}

/** One repository, on one provider, reachable with one organisation's credentials. */
export interface RepositoryProvider {
  readonly kind: ProviderKind;
  readonly owner: string;
  readonly repo: string;
  /** For display and for links back to the provider. */
  readonly fullName: string;

  readFile(path: string, ref: string): Promise<FileContents>;
  listBranches(): Promise<string[]>;
  /** The commit a ref points at. */
  resolveRef(ref: string): Promise<string>;
  createBranch(name: string, fromRevision: string): Promise<void>;
  commitText(options: CommitTextOptions): Promise<void>;
  commitBinary(options: CommitBinaryOptions): Promise<void>;
  openChangeRequest(options: OpenChangeRequestOptions): Promise<ChangeRequest>;
  openIssue(options: OpenIssueOptions): Promise<Issue>;
  compareCommit(buildCommit: string, branch: string): Promise<CommitComparison>;
  /**
   * Files containing an exact phrase. Used to locate source for text that
   * carries no build annotation, so it only has to be good enough to rank —
   * a human confirms the choice.
   */
  searchText(phrase: string): Promise<SearchHit[]>;
  /** Every file path in a ref's tree. Used to find locale files. */
  listPaths(ref: string): Promise<string[]>;
}

/**
 * Errors a provider raises that the API must translate rather than leak.
 *
 * A 404 from GitHub means "no such file", "no such branch" or "the App
 * cannot see this repository", and those want different HTTP responses and
 * very different messages. Deciding that inside the provider — which knows
 * what it asked for — beats guessing from a status code upstream.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-found'
      | 'not-installed'
      | 'forbidden'
      | 'conflict'
      | 'rate-limited'
      | 'unavailable',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
