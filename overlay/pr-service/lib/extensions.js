/**
 * Which browser extensions this service will talk to.
 *
 * Gates two things:
 *   - the OAuth redirect target (`https://<id>.chromiumapp.org/`), which was
 *     previously an open redirect to any attacker-supplied ID
 *   - the CORS origin allowlist
 */

/** A Chrome extension ID is 32 characters, a–p. */
const EXTENSION_ID_RE = /^[a-p]{32}$/;

export function parseAllowedExtensionIds(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => EXTENSION_ID_RE.test(s));
}

export function isWellFormedExtensionId(id) {
  return typeof id === 'string' && EXTENSION_ID_RE.test(id);
}

/**
 * @param {string} id
 * @param {object} env
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function checkExtensionId(id, env = process.env) {
  if (!isWellFormedExtensionId(id)) {
    return { ok: false, error: 'Malformed extension id' };
  }

  const allowed = parseAllowedExtensionIds(env.ALLOWED_EXTENSION_IDS);

  if (allowed.length === 0) {
    // Unconfigured is a deployment mistake in production, but blocking it in
    // development would make first-run setup impossible — the developer does
    // not know their unpacked extension's ID until Chrome assigns one.
    if (env.NODE_ENV === 'production') {
      return {
        ok: false,
        error: 'ALLOWED_EXTENSION_IDS is not configured on this service',
      };
    }
    return { ok: true };
  }

  return allowed.includes(id)
    ? { ok: true }
    : { ok: false, error: 'This extension is not allowed to use this service' };
}

/** Origins permitted to call the API. */
export function allowedOrigins(env = process.env) {
  const origins = parseAllowedExtensionIds(env.ALLOWED_EXTENSION_IDS).map(
    (id) => `chrome-extension://${id}`
  );
  if (env.APP_URL) origins.push(env.APP_URL.replace(/\/+$/, ''));
  return origins;
}

/**
 * Resolve the Access-Control-Allow-Origin value for a request.
 *
 * Returns null when the origin is not allowed, in which case no CORS header
 * should be sent and the browser will block the response.
 */
export function resolveCorsOrigin(requestOrigin, env = process.env) {
  // Non-browser callers (curl, server-to-server) send no Origin.
  if (!requestOrigin) return null;

  const allowed = allowedOrigins(env);

  // Same permissive-in-development stance as checkExtensionId, and only for
  // extension origins — never for arbitrary websites.
  if (
    allowed.length === 0 &&
    env.NODE_ENV !== 'production' &&
    requestOrigin.startsWith('chrome-extension://')
  ) {
    return requestOrigin;
  }

  return allowed.includes(requestOrigin) ? requestOrigin : null;
}
