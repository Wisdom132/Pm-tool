import { issueState } from '../../../lib/oauth-state.js';
import { checkExtensionId } from '../../../lib/extensions.js';
import { log } from '../../../lib/logger.js';

/**
 * Start the GitHub App user-authorisation flow.
 *
 * The extension ID is checked against the allowlist here rather than on the
 * callback, so a rejected extension never reaches GitHub at all.
 */
export default async function handler(req, res) {
  const { ext_id: extensionId } = req.query;

  if (!extensionId) return res.status(400).json({ error: 'ext_id is required' });

  const check = checkExtensionId(extensionId);
  if (!check.ok) {
    log.warn('auth.extension_rejected', { extensionId, reason: check.error });
    return res.status(403).json({ error: check.error });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'GITHUB_CLIENT_ID is not configured' });

  const state = await issueState({ extensionId });
  const redirectUri = `${process.env.APP_URL}/api/auth/extension-callback`;

  // A GitHub App's permissions are declared on the app itself, so no `scope`.
  const url =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  res.redirect(url);
}
