import { verifyExtensionToken } from '../../lib/withAuth.js';
import { getWriteToken } from '../../lib/github-app.js';
import { buildIssueBody } from '../../lib/patcher.js';
import { enforce, LIMITS } from '../../lib/rate-limit.js';
import { log } from '../../lib/logger.js';
import { initObservability } from '../../lib/observability.js';
import { Octokit } from '@octokit/rest';

/**
 * File the edits as an issue instead of a pull request.
 *
 * The escape hatch for pages with no build annotation: rather than guessing
 * at source files, the editor's intent is recorded verbatim for whoever does
 * know where the text lives. A wrong issue costs a moment; a wrong commit
 * costs a revert.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  await initObservability();

  const auth = await verifyExtensionToken(req, res);
  if (!auth) return;

  if (!(await enforce(res, 'create-pr', auth.userId, LIMITS.createPr))) return;

  const { repo, edits, pageUrl, note } = req.body || {};

  if (!repo || !repo.includes('/'))
    return res.status(400).json({ error: '`repo` must be "owner/name"' });
  if (!Array.isArray(edits) || edits.length === 0)
    return res.status(400).json({ error: '`edits` array is required' });
  if (!pageUrl) return res.status(400).json({ error: '`pageUrl` is required' });

  const [owner, name] = repo.split('/');
  const { login } = auth;

  try {
    const token = await getWriteToken({ owner, repo: name });
    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.issues.create({
      owner,
      repo: name,
      title: `[Inline Edit] Copy changes on ${new URL(pageUrl).hostname}`,
      body: buildIssueBody({ edits, editor: { login }, pageUrl, note }),
      labels: ['inline-edit', 'copy'],
    });

    log.info('create_issue.opened', { login, repo, issueNumber: data.number, edits: edits.length });
    res.json({ issueUrl: data.html_url, issueNumber: data.number });
  } catch (err) {
    log.error('create_issue.failed', { login, repo, error: err.message });
    res.status(500).json({ error: err.message });
  }
}
