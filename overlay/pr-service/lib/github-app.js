/**
 * GitHub App authentication.
 *
 * Two token types are in play:
 *
 *   user token         — identifies the editor and enumerates the repos they
 *                        can reach. Never used to write.
 *   installation token — acts as the App. Used for every write (branch,
 *                        commit, pull request), which is what lets an editor
 *                        without push access still submit a PR. Lives one
 *                        hour and is cached until shortly before expiry.
 */

import { SignJWT } from 'jose';
import { createPrivateKey } from 'node:crypto';
import { Octokit } from '@octokit/rest';
import { getStore } from './store.js';
import { log } from './logger.js';

const TOKEN_CACHE_PREFIX = 'inst_token:';

/**
 * The PEM may be supplied raw (with real newlines), with literal "\n"
 * sequences, or base64-encoded — all three are common in hosting UIs.
 */
export function normalizePrivateKey(raw) {
  if (!raw) throw new Error('GITHUB_APP_PRIVATE_KEY is not set');

  let key = raw.trim();

  if (!key.includes('BEGIN')) {
    key = Buffer.from(key, 'base64').toString('utf8').trim();
  }
  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
  }
  if (!key.includes('BEGIN')) {
    throw new Error('GITHUB_APP_PRIVATE_KEY is not a valid PEM');
  }
  return key;
}

/**
 * Parse a PEM into a signing key.
 *
 * GitHub issues App keys in PKCS#1 ("BEGIN RSA PRIVATE KEY"), while jose's
 * importPKCS8 only accepts PKCS#8 ("BEGIN PRIVATE KEY"). Node's
 * createPrivateKey reads both and returns a KeyObject that jose can sign with.
 */
export function loadPrivateKey(raw) {
  return createPrivateKey(normalizePrivateKey(raw));
}

/**
 * Short-lived JWT identifying the App itself.
 * `iat` is backdated 60s to tolerate clock skew, per GitHub's guidance.
 */
export async function createAppJwt(env = process.env) {
  const appId = env.GITHUB_APP_ID;
  if (!appId) throw new Error('GITHUB_APP_ID is not set');

  const key = loadPrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(String(appId))
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60) // GitHub rejects anything beyond 10 minutes
    .sign(key);
}

/** The installation covering a repository, or null if the App is not installed. */
export async function getRepoInstallationId({ owner, repo }) {
  const appJwt = await createAppJwt();
  const octokit = new Octokit({ auth: appJwt });

  try {
    const { data } = await octokit.apps.getRepoInstallation({ owner, repo });
    return data.id;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/** Mint (or reuse) an installation access token. */
export async function getInstallationToken(installationId) {
  const store = getStore();
  const cacheKey = TOKEN_CACHE_PREFIX + installationId;

  const cached = await store.get(cacheKey);
  if (cached?.token && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const appJwt = await createAppJwt();
  const octokit = new Octokit({ auth: appJwt });
  const { data } = await octokit.apps.createInstallationAccessToken({
    installation_id: installationId,
  });

  const expiresAt = new Date(data.expires_at).getTime();

  // Expire the cache entry a minute early so a token is never handed out
  // with less than that left to live.
  const ttl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000) - 60);
  await store.set(cacheKey, { token: data.token, expiresAt }, ttl);

  log.debug('github_app.token_minted', { installationId, expiresAt: data.expires_at });
  return data.token;
}

/**
 * A write-capable token for a repository.
 * @throws if the App is not installed on that repository
 */
export async function getWriteToken({ owner, repo }) {
  const installationId = await getRepoInstallationId({ owner, repo });
  if (!installationId) {
    throw new Error(
      `The Inline Edit GitHub App is not installed on ${owner}/${repo}. ` +
        `Install it from the app's settings page and grant access to this repository.`
    );
  }
  return getInstallationToken(installationId);
}

/**
 * Repositories the user can reach through installations of this App.
 * Uses the user token, so it reflects the user's own access, not the App's.
 */
export async function listAccessibleRepos(userToken) {
  const octokit = new Octokit({ auth: userToken });

  const { data: installs } = await octokit.apps.listInstallationsForAuthenticatedUser({
    per_page: 100,
  });

  const repos = [];
  for (const installation of installs.installations) {
    try {
      const { data } = await octokit.apps.listInstallationReposForAuthenticatedUser({
        installation_id: installation.id,
        per_page: 100,
      });
      for (const r of data.repositories) {
        repos.push({
          full_name: r.full_name,
          private: r.private,
          installation_id: installation.id,
        });
      }
    } catch (err) {
      log.warn('github_app.list_repos_failed', {
        installationId: installation.id,
        error: err.message,
      });
    }
  }

  return repos;
}
