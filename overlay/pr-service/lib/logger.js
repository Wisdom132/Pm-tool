/**
 * Minimal structured logger — one JSON object per line.
 *
 * Every call takes a stable `event` name plus a flat bag of fields, so logs
 * stay greppable and can be shipped to a real sink (Sentry, Datadog) later
 * without rewriting call sites.
 *
 * Level is controlled by LOG_LEVEL (debug | info | warn | error), default info.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, event, fields) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event, fields) => emit('debug', event, fields),
  info:  (event, fields) => emit('info',  event, fields),
  warn:  (event, fields) => emit('warn',  event, fields),
  error: (event, fields) => emit('error', event, fields),
};
