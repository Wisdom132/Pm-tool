import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveSite,
  clearSiteCache,
  editingParams,
} from '../inline-edit-tool/extension/src/site-resolver.js';

/**
 * The background bridge is a proxy: it answers `{ data }` on success and
 * `{ error }` on failure, so the API's own body is nested one level down.
 *
 * Reading `known` off the envelope instead of off `data` gives `undefined`,
 * which is falsy, which reads exactly like "this site is not registered" —
 * a silent failure that shipped, because nothing here was tested.
 */
const bridge = (response) => async () => response;

const options = {
  hostname: 'staging.acme.com',
  token: 'tok',
  serviceUrl: 'http://localhost:3333',
};

beforeEach(() => clearSiteCache());

describe('resolveSite', () => {
  it('unwraps the bridge envelope', async () => {
    const site = await resolveSite(
      bridge({
        data: {
          known: true,
          environmentId: 'env-1',
          repository: 'acme/site',
          branch: 'main',
          hostname: 'staging.acme.com',
          verified: true,
        },
      }),
      options,
    );

    expect(site.known).toBe(true);
    expect(site.environmentId).toBe('env-1');
    expect(site.repository).toBe('acme/site');
    expect(site.branch).toBe('main');
  });

  it('does not read the API body off the envelope', async () => {
    // The exact bug: a response shaped like the *unwrapped* body must not
    // be mistaken for success, or the shapes have silently swapped.
    const site = await resolveSite(bridge({ known: true, environmentId: 'env-1' }), options);
    expect(site.known).toBe(false);
  });

  it('reports a hostname the registry does not know', async () => {
    const site = await resolveSite(
      bridge({ data: { known: false, reason: 'staging.acme.com is not registered.' } }),
      options,
    );
    expect(site.known).toBe(false);
    expect(site.reason).toBe('staging.acme.com is not registered.');
  });

  it('has something to say when the API answers nothing useful', async () => {
    const site = await resolveSite(bridge({ data: {} }), options);
    expect(site.known).toBe(false);
    expect(site.reason).toMatch(/not registered/);
  });

  it('distinguishes unreachable from unregistered', async () => {
    // Telling somebody to register a site they already registered is worse
    // than saying the connection failed.
    const site = await resolveSite(bridge({ error: 'unhandled path /api/resolve' }), options);
    expect(site.known).toBe(false);
    expect(site.reason).toBe('unhandled path /api/resolve');
  });

  it('survives the bridge throwing', async () => {
    const site = await resolveSite(async () => {
      throw new Error('receiving end does not exist');
    }, options);
    expect(site.known).toBe(false);
    expect(site.reason).toMatch(/Could not reach/);
  });

  it('keeps a null branch, which means "read it from the page"', async () => {
    const site = await resolveSite(
      bridge({ data: { known: true, environmentId: 'env-1', branch: null } }),
      options,
    );
    expect(site.branch).toBeNull();
  });
});

describe('resolveSite — caching', () => {
  it('asks once per hostname', async () => {
    let calls = 0;
    const send = async () => {
      calls++;
      return { data: { known: true, environmentId: 'env-1' } };
    };

    await resolveSite(send, options);
    await resolveSite(send, options);
    expect(calls).toBe(1);
  });

  it('does not cache a failure', async () => {
    // A transient outage must not pin the page into an unusable state until
    // the next reload.
    let calls = 0;
    const send = async () => {
      calls++;
      return calls === 1 ? { error: 'down' } : { data: { known: true, environmentId: 'env-1' } };
    };

    expect((await resolveSite(send, options)).known).toBe(false);
    expect((await resolveSite(send, options)).known).toBe(true);
    expect(calls).toBe(2);
  });

  it('re-asks when forced', async () => {
    let calls = 0;
    const send = async () => {
      calls++;
      return { data: { known: true, environmentId: 'env-1' } };
    };

    await resolveSite(send, options);
    await resolveSite(send, { ...options, force: true });
    expect(calls).toBe(2);
  });

  it('keys on the service URL as well as the hostname', async () => {
    let calls = 0;
    const send = async () => {
      calls++;
      return { data: { known: true, environmentId: 'env-1' } };
    };

    await resolveSite(send, options);
    await resolveSite(send, { ...options, serviceUrl: 'https://other.example' });
    expect(calls).toBe(2);
  });
});

describe('editingParams', () => {
  const registered = { environmentId: 'env-1', branch: 'main' };
  const preview = { environmentId: 'env-2', branch: null };

  it('sends only the environment id for a registered branch', () => {
    // The server decides. Sending a branch would imply the client has a say.
    expect(editingParams(registered, { branch: 'attacker', commit: null })).toEqual({
      environmentId: 'env-1',
    });
  });

  it('sends the page branch when the site takes it from the page', () => {
    expect(editingParams(preview, { branch: 'feature/x', commit: null })).toEqual({
      environmentId: 'env-2',
      branch: 'feature/x',
    });
  });

  it('always forwards the build commit', () => {
    // It is what keeps a change request's diff to just these edits.
    expect(editingParams(registered, { branch: null, commit: 'abc1234' })).toEqual({
      environmentId: 'env-1',
      buildCommit: 'abc1234',
    });
  });

  it('omits what the page did not carry', () => {
    expect(editingParams(registered, {})).toEqual({ environmentId: 'env-1' });
  });
});
