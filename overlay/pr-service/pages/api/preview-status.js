import { verifyExtensionToken } from '../../lib/withAuth.js';
import { compareBuildCommit } from '../../lib/github.js';
import { getWriteToken } from '../../lib/github-app.js';
import { log } from '../../lib/logger.js';
import { enforce, LIMITS } from '../../lib/rate-limit.js';

/**
 * How does the commit a preview was built from relate to its branch today?
 *
 * Lets the extension warn before an edit session rather than surfacing the
 * problem only once a PR has been opened.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = await verifyExtensionToken(req, res);
  if (!auth) return;

  if (!(await enforce(res, 'read', auth.userId, LIMITS.read))) return;

  const { repo, branch, commit } = req.query;

  if (!repo || !repo.includes('/'))
    return res.status(400).json({ error: 'repo query param must be owner/name' });
  if (!branch) return res.status(400).json({ error: 'branch query param is required' });
  if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit))
    return res.status(400).json({ error: 'commit query param must be a commit SHA' });

  const [owner, name] = repo.split('/');

  try {
    const status = await compareBuildCommit({
      token: await getWriteToken({ owner, repo: name }),
      owner,
      repo: name,
      buildCommit: commit,
      branch,
    });
    log.debug('preview_status.checked', { repo, branch, status: status.status });
    res.json(status);
  } catch (err) {
    // A commit GitHub cannot resolve is itself the answer: the preview is
    // built from something no longer in this repository's history.
    log.warn('preview_status.failed', { repo, branch, error: err.message });
    res.status(200).json({
      status: 'unknown',
      behindBy: 0,
      usable: false,
      error: err.message,
    });
  }
}
