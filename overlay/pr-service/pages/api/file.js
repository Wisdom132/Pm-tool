import { verifyExtensionToken } from '../../lib/withAuth.js';
import { getWriteToken } from '../../lib/github-app.js';
import { getFileContent } from '../../lib/github.js';
import { enforce, LIMITS } from '../../lib/rate-limit.js';
import { log } from '../../lib/logger.js';

/**
 * Read one source file so it can be edited in the browser.
 *
 * The blob `sha` is returned with the content and handed back on commit.
 * GitHub rejects a stale sha, which is what stops an in-browser edit from
 * clobbering a push that landed while the panel was open.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = await verifyExtensionToken(req, res);
  if (!auth) return;

  if (!(await enforce(res, 'read', auth.userId, LIMITS.read))) return;

  const { repo, branch, path } = req.query;

  if (!repo || !repo.includes('/'))
    return res.status(400).json({ error: 'repo query param must be owner/name' });
  if (!branch) return res.status(400).json({ error: 'branch query param is required' });
  if (!path) return res.status(400).json({ error: 'path query param is required' });

  // The annotation supplies this, but it arrives from a page we do not
  // control, so it is treated as untrusted input.
  if (path.includes('..') || path.startsWith('/')) {
    return res.status(400).json({ error: 'path must be relative to the repository root' });
  }

  const [owner, name] = repo.split('/');

  try {
    const token = await getWriteToken({ owner, repo: name });
    const { content, sha } = await getFileContent({
      token,
      owner,
      repo: name,
      path,
      branch,
    });

    log.debug('file.read', { repo, path, bytes: content.length });
    res.json({ content, sha, path, branch });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({
        error: `${path} is not on branch "${branch}". The preview may have been built from a different commit.`,
      });
    }
    log.error('file.read_failed', { repo, path, error: err.message });
    res.status(500).json({ error: err.message });
  }
}
