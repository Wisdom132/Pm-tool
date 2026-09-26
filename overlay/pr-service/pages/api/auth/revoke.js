import { verifyExtensionToken } from '../../../lib/withAuth.js';
import { destroySession } from '../../../lib/sessions.js';
import { log } from '../../../lib/logger.js';

/**
 * Disconnect: drop the server-side session and revoke the GitHub token so the
 * next authorisation shows the full consent screen from scratch.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await verifyExtensionToken(req, res);
  if (!auth) return; // 401 already sent

  const credentials = Buffer.from(
    `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`
  ).toString('base64');

  try {
    await fetch(
      `https://api.github.com/applications/${process.env.GITHUB_CLIENT_ID}/token`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'inline-edit-tool',
        },
        body: JSON.stringify({ access_token: auth.githubToken }),
      }
    );
  } catch (err) {
    // Already revoked, or GitHub unreachable — the local session still goes.
    log.warn('auth.revoke_failed', { login: auth.login, error: err.message });
  }

  // Always destroy the session, even if the remote revoke failed.
  await destroySession(auth.sessionId);
  log.info('session.destroyed', { login: auth.login });

  res.status(200).json({ ok: true });
}
