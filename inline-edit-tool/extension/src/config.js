"use strict";

// ============================================================
//  Shared extension configuration
// ============================================================

/**
 * Used only when nothing has been configured yet. A deployed team points the
 * extension at their own HTTPS pr-service via the popup.
 */
export const DEFAULT_SERVICE_URL = "http://localhost:3001";

/** Hosts where plaintext HTTP is acceptable because traffic never leaves the machine. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopback(hostname) {
  return LOOPBACK_HOSTS.has(hostname);
}

/**
 * Validate a pr-service URL.
 *
 * The extension sends a bearer token to this origin on every request, so
 * plaintext HTTP is rejected for anything but loopback — a preview-deploy
 * setup always talks to a real deployment over HTTPS.
 *
 * @param {string} raw
 * @returns {{ok: true, url: string} | {ok: false, error: string}}
 */
export function validateServiceUrl(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { ok: false, error: "Service URL is required" };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Not a valid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "URL must start with https://" };
  }

  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    return {
      ok: false,
      error: "Must use https:// — plaintext http is only allowed for localhost",
    };
  }

  // Normalise: keep origin + any path prefix, drop trailing slash and query.
  const path = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${parsed.origin}${path}` };
}

/** Resolve a stored value to a usable service URL, falling back to the default. */
export function resolveServiceUrl(stored) {
  const result = validateServiceUrl(stored || "");
  return result.ok ? result.url : DEFAULT_SERVICE_URL;
}
