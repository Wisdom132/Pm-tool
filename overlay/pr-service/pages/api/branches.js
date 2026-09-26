import { verifyExtensionToken } from '../../lib/withAuth.js';
import { listBranches } from '../../lib/github.js';
import { log } from '../../lib/logger.js';
import { enforce, LIMITS } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = await verifyExtensionToken(req, res);
  if (!auth) return;

  if (!(await enforce(res, 'read', auth.userId, LIMITS.read))) return;

  const { repo } = req.query; // e.g. "owner/name"
  if (!repo || !repo.includes('/')) {
    return res.status(400).json({ error: 'repo query param must be owner/name' });
  }

  const [owner, name] = repo.split('/');
  try {
    const branches = await listBranches({ token: auth.githubToken, owner, repo: name });
    log.debug('branches.list', { login: auth.login, repo, count: branches.length });
    res.json({ branches });
  } catch (err) {
    log.error('branches.list_failed', { login: auth.login, repo, error: err.message });
    res.status(500).json({ error: err.message });
  }
}
