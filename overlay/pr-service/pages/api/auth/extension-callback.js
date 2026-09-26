import { consumeState } from '../../../lib/oauth-state.js';
import { checkExtensionId } from '../../../lib/extensions.js';
import { createSession } from '../../../lib/sessions.js';
import { log } from '../../../lib/logger.js';

/**
 * Finish the GitHub App user-authorisation flow.
 *
 * The redirect target comes from the stored nonce, never from the query
 * string, so the callback cannot be pointed at an arbitrary extension.
 */
export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) return res.status(400).json({ error: 'Missing code' });

  const stateRecord = await consumeState(state);
  if (!stateRecord) {
    log.warn('auth.state_rejected', {});
    return res.status(400).json({ error: 'Invalid, expired or already-used state parameter' });
  }

  const { extensionId } = stateRecord;

  // Re-check: the allowlist may have changed mid-flow.
  const check = checkExtensionId(extensionId);
  if (!check.ok) return res.status(403).json({ error: check.error });

  // Exchange the code for a user access token.
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${process.env.APP_URL}/api/auth/extension-callback`,
    }),
  });

  const tokenBody = await tokenRes.json().catch(() => ({}));
  const { access_token: accessToken, refresh_token: refreshToken } = tokenBody;

  if (!accessToken) {
    log.warn('auth.code_exchange_failed', { error: tokenBody.error || 'no token returned' });
    return res
      .status(400)
      .json({ error: tokenBody.error_description || tokenBody.error || 'Code exchange failed' });
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'inline-edit-tool',
    },
  });

  if (!userRes.ok) {
    return res.status(502).json({ error: 'Could not read GitHub user profile' });
  }

  const user = await userRes.json();

  const { sessionId } = await createSession({
    githubToken: accessToken,
    refreshToken,
    login: user.login,
    userId: user.id,
  });

  // The session ID is opaque, so the login travels alongside it for display —
  // there is nothing in it for the extension to decode.
  const params = new URLSearchParams({ token: sessionId, login: user.login });
  res.redirect(`https://${extensionId}.chromiumapp.org/?${params}`);
}
