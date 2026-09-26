"use strict";

// ============================================================
//  Session storage
//
//  The session ID lives in chrome.storage.local, not .sync:
//  sync replicates to Google's servers and across every profile
//  the user is signed into, which is the wrong blast radius for
//  a credential. Non-secret preferences stay in .sync so they
//  still follow the user between machines.
//
//  The session ID is opaque, so the GitHub login is stored
//  alongside it for display — there is nothing to decode out of
//  it the way the old JWT allowed.
// ============================================================

const SESSION_KEY = "authToken";
const LOGIN_KEY = "authLogin";

/** @returns {Promise<string|null>} */
export async function getSessionId() {
  const stored = await chrome.storage.local.get([SESSION_KEY]);
  return stored[SESSION_KEY] || null;
}

/** @returns {Promise<string|null>} */
export async function getSessionLogin() {
  const stored = await chrome.storage.local.get([LOGIN_KEY]);
  return stored[LOGIN_KEY] || null;
}

export async function setSession(id, login) {
  await chrome.storage.local.set({
    [SESSION_KEY]: id,
    [LOGIN_KEY]: login || null,
  });
}

export async function clearSession() {
  await chrome.storage.local.remove([SESSION_KEY, LOGIN_KEY]);
}

/**
 * Remove sessions written by earlier versions, which stored a JWT in
 * chrome.storage.sync. Those tokens no longer authenticate against the
 * service, and leaving one there would keep a GitHub token replicated across
 * the user's profiles — so it is deleted rather than migrated.
 */
export async function clearLegacySession() {
  const legacy = await chrome.storage.sync.get([SESSION_KEY]);
  if (legacy[SESSION_KEY]) await chrome.storage.sync.remove(SESSION_KEY);
}
