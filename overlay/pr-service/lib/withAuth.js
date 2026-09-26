import { readSession } from './sessions.js';

/**
 * Resolve the opaque session ID sent by the extension.
 *
 * Previously this verified a JWT that carried the GitHub token in its own
 * payload; the token now lives only in the session store.
 *
 * On success returns { githubToken, login, userId, sessionId }.
 * On failure writes 401 and returns null.
 */
export async function verifyExtensionToken(req, res) {
  const header = req.headers.authorization || '';
  const sessionId = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!sessionId) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return null;
  }

  const session = await readSession(sessionId);
  if (!session) {
    res.status(401).json({ error: 'Session expired or invalid — reconnect GitHub' });
    return null;
  }

  return { ...session, sessionId };
}
