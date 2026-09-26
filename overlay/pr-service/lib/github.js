import Anthropic from '@anthropic-ai/sdk';
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

// Source file extensions to scan when walking the git tree
const SOURCE_EXTS = new Set(['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.html', '.htm']);

/**
 * Walk the full git tree for `branch`, scan every source file for `text`,
 * and return { sourceFile, sourceLine }. Uses Claude AI to disambiguate
 * when multiple files contain the same text.
 */
export async function findTextInRepo({ token, owner, repo, branch, text, pageUrl }) {
  log.debug('find.start', { repo: `${owner}/${repo}`, branch, textLength: text.length });

  if (text.length < 4) {
    log.debug('find.skipped_short', { textLength: text.length });
    return null;
  }

  try {
    const octokit = client(token);

    // 1. Get full recursive tree for the branch
    const { data: treeData } = await octokit.git.getTree({
      owner, repo,
      tree_sha: branch,
      recursive: '1',
    });

    const sourceFiles = treeData.tree.filter((item) => {
      if (item.type !== 'blob') return false;
      const ext = item.path.slice(item.path.lastIndexOf('.'));
      return SOURCE_EXTS.has(ext);
    });

    log.debug('find.tree_scanned', {
      treeEntries: treeData.tree.length,
      sourceFiles: sourceFiles.length,
    });

    // 2. Fetch files in parallel batches and search for text
    const BATCH = 20;
    const matches = []; // { filePath, lineIdx }

    for (let i = 0; i < sourceFiles.length; i += BATCH) {
      const batch = sourceFiles.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const { content } = await getFileContent({
            token, owner, repo, path: item.path, branch,
          });
          const lines = content.split('\n');
          const lineIdx = lines.findIndex((l) => l.includes(text));
          if (lineIdx !== -1) {
            log.debug('find.match', { file: item.path, line: lineIdx + 1 });
            matches.push({ filePath: item.path, lineIdx });
          }
        })
      );
      // Log any individual fetch errors but keep going
      results.forEach((r, j) => {
        if (r.status === 'rejected')
          log.warn('find.fetch_failed', { file: batch[j].path, error: r.reason?.message });
      });
    }

    log.debug('find.complete', { matches: matches.length });

    if (matches.length === 0) return null;

    if (matches.length === 1) {
      return { sourceFile: matches[0].filePath, sourceLine: matches[0].lineIdx + 1 };
    }

    // 3. Multiple matches — use Claude to pick the best file
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      log.warn('find.no_api_key', { matches: matches.length, fallback: matches[0].filePath });
      return { sourceFile: matches[0].filePath, sourceLine: matches[0].lineIdx + 1 };
    }

    log.debug('find.disambiguating', { matches: matches.length });
    const anthropic = new Anthropic({ apiKey });

    const fileList = matches.map((m, i) => `${i + 1}. ${m.filePath}`).join('\n');
    const prompt = `A user edited the text "${text}" on the page ${pageUrl || '(unknown URL)'}.

The text appears in multiple source files:
${fileList}

Which file is most likely the one rendered on that page? Reply with just the number (e.g. "2").`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: prompt }],
    });

    const answer = message.content[0]?.text?.trim();
    const idx = parseInt(answer, 10) - 1;
    const chosen = Number.isInteger(idx) && idx >= 0 && idx < matches.length
      ? matches[idx]
      : matches[0];

    log.debug('find.disambiguated', { chosen: chosen.filePath, raw: answer });
    return { sourceFile: chosen.filePath, sourceLine: chosen.lineIdx + 1 };

  } catch (err) {
    log.error('find.failed', { repo: `${owner}/${repo}`, branch, error: err.message });
    return null;
  }
}

/** Every file path in a branch's tree. */
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
