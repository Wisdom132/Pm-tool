import { verifyExtensionToken } from '../../lib/withAuth.js';
import { getWriteToken } from '../../lib/github-app.js';
import { findSourceCandidates } from '../../lib/locate-source.js';
import { enforce, LIMITS } from '../../lib/rate-limit.js';
import { log } from '../../lib/logger.js';

/**
 * Suggest where a piece of unannotated text might live.
 *
 * Deliberately a separate step from creating the pull request: the caller
 * shows these to the editor and sends back the one they confirmed. Nothing
 * is written on the strength of a guess.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await verifyExtensionToken(req, res);
  if (!auth) return;

  if (!(await enforce(res, 'read', auth.userId, LIMITS.read))) return;

  const { repo, branch, text } = req.body || {};

  if (!repo || !repo.includes('/'))
    return res.status(400).json({ error: '`repo` must be "owner/name"' });
  if (!branch) return res.status(400).json({ error: '`branch` is required' });
  if (typeof text !== 'string' || !text.trim())
    return res.status(400).json({ error: '`text` is required' });

  const [owner, name] = repo.split('/');

  try {
    const result = await findSourceCandidates({
      token: await getWriteToken({ owner, repo: name }),
      owner,
      repo: name,
      branch,
      text,
    });
    res.json(result);
  } catch (err) {
    log.error('locate.failed', { repo, error: err.message });
    res.status(500).json({ error: err.message });
  }
}
