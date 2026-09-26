import { verifyExtensionToken } from '../../lib/withAuth.js';
import { listAccessibleRepos } from '../../lib/github-app.js';
import { enforce, LIMITS } from '../../lib/rate-limit.js';
import { log } from '../../lib/logger.js';

/**
 * Repositories reachable through installations of the GitHub App.
 *
 * This is narrower than the old "every repo the user can see": it lists only
 * what the App has actually been installed on, which is what can be written to.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = await verifyExtensionToken(req, res);
  if (!auth) return;

  if (!(await enforce(res, 'read', auth.userId, LIMITS.read))) return;

  try {
    const repos = await listAccessibleRepos(auth.githubToken);
    log.debug('repos.list', { login: auth.login, count: repos.length });
    res.json({ repos });
  } catch (err) {
    log.error('repos.list_failed', { login: auth.login, error: err.message });
    res.status(500).json({ error: err.message });
  }
}
