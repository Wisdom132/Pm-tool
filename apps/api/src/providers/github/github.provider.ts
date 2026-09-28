import { Octokit } from '@octokit/rest';
import {
  ProviderError,
  type ChangeRequest,
  type CommitBinaryOptions,
  type CommitComparison,
  type CommitTextOptions,
  type FileContents,
  type Issue,
  type OpenChangeRequestOptions,
  type OpenIssueOptions,
  type ProviderKind,
  type RepositoryProvider,
  type SearchHit,
} from '../provider.types';

/** How the provider obtains a token. Async because App tokens are minted. */
export type TokenSource = () => Promise<string>;

/**
 * GitHub behind the provider interface.
 *
 * Ported from the former `overlay/pr-service/lib/github.js`, which has since
 * been deleted — `git log --follow` reaches it. Three things changed, each
 * forced by the interface and each a latent bug before:
 *
 *   - Reads take a ref, not a branch. The old code passed the branch name
 *     even when the page carried a build commit, so the source panel could
 *     show a file the user was not looking at.
 *   - `getContent` is narrowed. It returns a directory listing for a
 *     directory path and a redirect for a symlink; the old code read
 *     `data.content` off both and produced `undefined` rather than an error.
 *   - Every failure becomes a ProviderError with a cause, so a 404 on a
 *     missing file and a 404 on an uninstalled App stop being the same
 *     message.
 */
export class GithubProvider implements RepositoryProvider {
  readonly kind: ProviderKind = 'github';

  constructor(
    readonly owner: string,
    readonly repo: string,
    private readonly token: TokenSource,
    /** Set for GitHub Enterprise. Undefined means github.com. */
    private readonly baseUrl?: string,
  ) {}

  get fullName() {
    return `${this.owner}/${this.repo}`;
  }

  private async client(): Promise<Octokit> {
    return new Octokit({ auth: await this.token(), baseUrl: this.baseUrl });
  }

  async readFile(path: string, ref: string): Promise<FileContents> {
    const octokit = await this.client();

    try {
      const { data } = await octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
      });

      if (Array.isArray(data)) {
        throw new ProviderError(`${path} is a directory, not a file.`, 'not-found');
      }
      if (data.type !== 'file' || typeof data.content !== 'string') {
        throw new ProviderError(`${path} is a ${data.type}, which cannot be edited.`, 'not-found');
      }

      return {
        content: Buffer.from(data.content, 'base64').toString('utf8'),
        revision: data.sha,
      };
    } catch (err) {
      throw this.translate(err, `${path} at ${ref}`);
    }
  }

  async listBranches(): Promise<string[]> {
    const octokit = await this.client();

    try {
      const branches = await octokit.paginate(octokit.repos.listBranches, {
        owner: this.owner,
        repo: this.repo,
        per_page: 100,
      });
      return branches.map((b) => b.name);
    } catch (err) {
      throw this.translate(err, `branches of ${this.fullName}`);
    }
  }

  async resolveRef(ref: string): Promise<string> {
    const octokit = await this.client();

    // A 40-character hex string is already a commit; asking GitHub to
    // resolve it costs a call and fails for a commit not on any branch.
    if (/^[0-9a-f]{40}$/i.test(ref)) return ref;

    try {
      const { data } = await octokit.repos.getCommit({
        owner: this.owner,
        repo: this.repo,
        ref,
      });
      return data.sha;
    } catch (err) {
      throw this.translate(err, `ref ${ref}`);
    }
  }

  async createBranch(name: string, fromRevision: string): Promise<void> {
    const octokit = await this.client();

    try {
      await octokit.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${name}`,
        sha: fromRevision,
      });
    } catch (err) {
      if ((err as { status?: number }).status === 422) {
        throw new ProviderError(`Branch ${name} already exists.`, 'conflict', err);
      }
      throw this.translate(err, `branch ${name}`);
    }
  }

  async commitText({ path, branch, content, message, revision }: CommitTextOptions): Promise<void> {
    const octokit = await this.client();

    try {
      await octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path,
        branch,
        message,
        sha: revision,
        content: Buffer.from(content, 'utf8').toString('base64'),
      });
    } catch (err) {
      throw this.translate(err, `${path} on ${branch}`);
    }
  }

  async commitBinary({ path, branch, base64, message }: CommitBinaryOptions): Promise<void> {
    const octokit = await this.client();

    // Replacing an existing file needs its blob sha; creating one must not
    // send a sha at all. Reading first is the only way to know which.
    let revision: string | undefined;
    try {
      revision = (await this.readFile(path, branch)).revision;
    } catch {
      // Absent — a create, not an update.
    }

    try {
      await octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path,
        branch,
        message,
        sha: revision,
        content: base64,
      });
    } catch (err) {
      throw this.translate(err, `${path} on ${branch}`);
    }
  }

  async openChangeRequest({ title, body, head, base }: OpenChangeRequestOptions): Promise<ChangeRequest> {
    const octokit = await this.client();

    try {
      const { data } = await octokit.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        head,
        base,
      });
      return { url: data.html_url, number: data.number };
    } catch (err) {
      throw this.translate(err, `pull request into ${base}`);
    }
  }

  async openIssue({ title, body, labels }: OpenIssueOptions): Promise<Issue> {
    const octokit = await this.client();

    try {
      const { data } = await octokit.issues.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        labels,
      });
      return { url: data.html_url, number: data.number };
    } catch (err) {
      throw this.translate(err, `issue on ${this.fullName}`);
    }
  }

  /**
   * How the build commit relates to the branch.
   *
   * `ahead` means the branch moved on but still contains the build commit,
   * so branching from it produces a clean change request. `diverged` means
   * the branch was rebased or force-pushed and the build commit is no longer
   * reachable — patching against it would produce a confusing diff.
   */
  async compareCommit(buildCommit: string, branch: string): Promise<CommitComparison> {
    const octokit = await this.client();

    try {
      const { data } = await octokit.repos.compareCommits({
        owner: this.owner,
        repo: this.repo,
        base: buildCommit,
        head: branch,
      });

      return {
        status: data.status as CommitComparison['status'],
        aheadBy: data.ahead_by ?? 0,
        usable: data.status === 'identical' || data.status === 'ahead',
        tipRevision: data.commits?.at(-1)?.sha || buildCommit,
      };
    } catch (err) {
      // A commit GitHub has never seen is the normal case for a stale
      // preview, and it is not an error worth failing the request over —
      // the caller only wants to know whether it is safe to patch.
      if ((err as { status?: number }).status === 404) {
        return { status: 'unknown', aheadBy: 0, usable: false, tipRevision: buildCommit };
      }
      throw this.translate(err, `commit ${buildCommit}`);
    }
  }

  async searchText(phrase: string): Promise<SearchHit[]> {
    const octokit = await this.client();

    try {
      const { data } = await octokit.search.code({
        // Quoted, so it is a phrase. Embedded quotes would end it early.
        q: `"${phrase.replace(/"/g, '')}" repo:${this.fullName}`,
        per_page: 20,
      });
      return (data.items ?? []).map((item) => ({ path: item.path }));
    } catch (err) {
      // Search is the one operation that is routinely unavailable on a
      // healthy repository: very new and very large repositories are not
      // always indexed. Callers offer the user a manual path instead.
      throw new ProviderError(
        `GitHub code search is not available for ${this.fullName}. Very new or very large repositories are sometimes not indexed.`,
        'unavailable',
        err,
      );
    }
  }

  async listPaths(ref: string): Promise<string[]> {
    const octokit = await this.client();

    try {
      const { data } = await octokit.git.getTree({
        owner: this.owner,
        repo: this.repo,
        tree_sha: ref,
        recursive: '1',
      });

      if (data.truncated) {
        // Silently returning a partial tree is how "the locale file is not
        // in this repo" gets reported for a repo that plainly contains it.
        throw new ProviderError(
          `${this.fullName} is too large to list in one request.`,
          'unavailable',
        );
      }

      return data.tree.filter((item) => item.type === 'blob' && item.path).map((item) => item.path!);
    } catch (err) {
      throw this.translate(err, `tree of ${this.fullName} at ${ref}`);
    }
  }

  /**
   * GitHub's status codes are ambiguous on their own: a 404 means "no such
   * file", "no such branch", or "the App cannot see this repository", and a
   * 403 means both "forbidden" and "rate limited". Translating here, where
   * what was asked for is known, is what stops the API guessing upstream.
   */
  private translate(err: unknown, subject: string): ProviderError {
    if (err instanceof ProviderError) return err;

    const status = (err as { status?: number }).status;
    const message = (err as { message?: string }).message ?? 'unknown error';

    switch (status) {
      case 404:
        return new ProviderError(`Could not find ${subject} in ${this.fullName}.`, 'not-found', err);
      case 403:
        return /rate limit/i.test(message)
          ? new ProviderError(`GitHub rate limit reached. Try again shortly.`, 'rate-limited', err)
          : new ProviderError(
              `The GitHub App does not have permission for ${subject}. Check its repository access.`,
              'forbidden',
              err,
            );
      case 409:
      case 422:
        return new ProviderError(`GitHub rejected the change to ${subject}: ${message}`, 'conflict', err);
      default:
        return new ProviderError(`GitHub could not be reached for ${subject}: ${message}`, 'unavailable', err);
    }
  }
}
