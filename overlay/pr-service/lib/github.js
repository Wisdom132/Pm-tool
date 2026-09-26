import { Octokit } from '@octokit/rest';
import { log } from './logger.js';

function client(token) {
  return new Octokit({ auth: token });
}

export async function listRepos(token) {
  const octokit = client(token);
  const { data } = await octokit.repos.listForAuthenticatedUser({
    sort: 'updated',
    per_page: 100,
  });
  return data.map((r) => ({ full_name: r.full_name, private: r.private }));
}

export async function listBranches({ token, owner, repo }) {
  const octokit = client(token);
  const { data } = await octokit.repos.listBranches({ owner, repo, per_page: 100 });
  return data.map((b) => b.name);
}

/** Resolve a branch name to its tip commit SHA. */
export async function getBranchSha({ token, owner, repo, branch }) {
  const octokit = client(token);
  const { data: ref } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
  return ref.object.sha;
}

export async function createBranch({ token, owner, repo, branchName, fromSha }) {
  const octokit = client(token);
  await octokit.git.createRef({
    owner, repo,
    ref: `refs/heads/${branchName}`,
    sha: fromSha,
  });
}

/**
 * Compare the commit a preview was built from against the current branch tip.
 *
 * `ahead` means the branch has moved on but still contains the build commit,
 * so branching from that commit produces a clean PR. `diverged` means the
 * branch was rebased or force-pushed and the build commit is no longer
 * reachable — patching against it would produce a confusing diff.
 *
 * @returns {{status: string, behindBy: number, usable: boolean, tipSha: string}}
 */
export async function compareBuildCommit({ token, owner, repo, buildCommit, branch }) {
  const octokit = client(token);
  const { data } = await octokit.repos.compareCommits({
    owner, repo,
    base: buildCommit,
    head: branch,
  });

  return {
    status: data.status,                       // identical | ahead | behind | diverged
    behindBy: data.ahead_by ?? 0,              // commits added to the branch since the build
    usable: data.status === 'identical' || data.status === 'ahead',
    tipSha: data.commits?.at(-1)?.sha || buildCommit,
  };
}

export async function getFileContent({ token, owner, repo, path, branch }) {
  const octokit = client(token);
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { content, sha: data.sha };
}

export async function commitFileChange({ token, owner, repo, path, branch, content, sha, message }) {
  const octokit = client(token);
  await octokit.repos.createOrUpdateFileContents({
    owner, repo, path, message, branch,
    sha,
    content: Buffer.from(content, 'utf8').toString('base64'),
  });
}

/** Every file path in a branch's tree. Used to locate locale files. */
export async function listTreePaths({ token, owner, repo, branch }) {
  const octokit = client(token);
  const { data } = await octokit.git.getTree({
    owner, repo,
    tree_sha: branch,
    recursive: '1',
  });
  return data.tree.filter((item) => item.type === 'blob').map((item) => item.path);
}

export async function openPullRequest({ token, owner, repo, title, body, head, base }) {
  const octokit = client(token);
  const { data } = await octokit.pulls.create({ owner, repo, title, body, head, base });
  return { prUrl: data.html_url, prNumber: data.number };
}
