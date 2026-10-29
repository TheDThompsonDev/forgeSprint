import { MAX_INLINE_WAIT_MS } from './constants.js';

/**
 * Jira documents `Retry-After` on 429 as a number of seconds.
 * Non-numeric values are ignored so the caller uses exponential backoff.
 * @param {string | null | undefined} header
 * @returns {number | undefined}
 */
export function parseRetryAfterSeconds(header) {
  if (header == null || header === '') {
    return undefined;
  }
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds;
}

/**
 * Exponential backoff with jitter. `Retry-After` is the minimum delay.
 * @param {{ attempt: number, retryAfterSeconds?: number, random?: () => number }} options
 * @returns {number} delay in milliseconds
 */
export function retryDelayMs({ attempt, retryAfterSeconds, random = Math.random }) {
  const exponentSeconds = Math.min(60, 2 ** attempt);
  const jitterSeconds = exponentSeconds * 0.2 * random();
  const backoffMs = (exponentSeconds + jitterSeconds) * 1000;
  if (retryAfterSeconds == null) {
    return backoffMs;
  }
  return Math.max(backoffMs, retryAfterSeconds * 1000);
}

/**
 * @param {number | undefined} retryAfterSeconds
 * @returns {boolean}
 */
export function shouldDeferRateLimit(retryAfterSeconds) {
  if (retryAfterSeconds == null) {
    return false;
  }
  return retryAfterSeconds * 1000 > MAX_INLINE_WAIT_MS;
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
