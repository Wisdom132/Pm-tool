/**
 * Error reporting.
 *
 * Sentry is loaded dynamically and only when SENTRY_DSN is set, so a
 * deployment that does not want it pays nothing — no dependency, no bundle
 * weight, no network calls. Everything still lands in the structured logs
 * either way.
 *
 * Call `initObservability()` once from a route that runs early; it is
 * idempotent.
 */

import { log, setErrorSink } from './log.js';

let started = false;

export async function initObservability() {
  if (started) return;
  started = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    // Optional peer: absent unless the operator installed it.
    const Sentry = await import('@sentry/node');

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0,
      // Structured logs already carry the detail; this is for alerting.
      beforeSend(event) {
        return event;
      },
    });

    setErrorSink((eventName, fields) => {
      Sentry.captureMessage(eventName, {
        level: 'error',
        extra: fields,
      });
    });

    log.info('observability.started', { sink: 'sentry' });
  } catch (err) {
    // A missing package must not stop the service booting.
    log.warn('observability.unavailable', {
      detail: 'SENTRY_DSN is set but @sentry/node is not installed',
      error: err.message,
    });
  }
}
