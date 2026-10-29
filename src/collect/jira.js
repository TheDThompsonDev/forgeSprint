import api, { route } from '@forge/api';
import { MAX_ATTEMPTS, MAX_INLINE_WAIT_MS } from './constants.js';
import { parseRetryAfterSeconds, retryDelayMs, shouldDeferRateLimit, sleep } from './retry.js';

export class JiraHttpError extends Error {
  /**
   * @param {number} status
   * @param {string} label
   * @param {number | undefined} retryAfterSeconds
   */
  constructor(status, label, retryAfterSeconds) {
    super(`Jira ${label} returned HTTP ${status}`);
    this.name = 'JiraHttpError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RateLimitError extends JiraHttpError {
  /**
   * @param {number} retryAfterSeconds
   * @param {string} label
   */
  constructor(retryAfterSeconds, label) {
    super(429, label, retryAfterSeconds);
    this.name = 'RateLimitError';
  }
}

/**
 * @param {string} label
 * @param {() => Promise<Response>} send
 */
export async function sendWithRetry(label, send) {
  /** @type {JiraHttpError | undefined} */
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await send();
    if (response.status !== 429 && response.status < 500) {
      return response;
    }
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
    await drain(response);
    if (response.status === 429 && shouldDeferRateLimit(retryAfterSeconds)) {
      throw new RateLimitError(retryAfterSeconds ?? 30, label);
    }
    lastError = new JiraHttpError(response.status, label, retryAfterSeconds);
    if (attempt === MAX_ATTEMPTS - 1) {
      break;
    }
    const delay = Math.min(retryDelayMs({ attempt, retryAfterSeconds }), MAX_INLINE_WAIT_MS);
    await sleep(delay);
  }
  if (lastError?.status === 429) {
    throw new RateLimitError(lastError.retryAfterSeconds ?? 30, label);
  }
  throw lastError ?? new JiraHttpError(500, label, undefined);
}

/**
 * @param {Response} response
 * @param {string} label
 */
export async function readJson(response, label) {
  if (!response.ok) {
    await drain(response);
    throw new JiraHttpError(response.status, label, undefined);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function drain(response) {
  try {
    await response.text();
  } catch {
    // The status is the part we keep. The body can contain issue text.
  }
}

/**
 * App-context Jira client. Paths are built with the `route` template.
 */
export function createAppJira() {
  return createJira(() => api.asApp());
}

/**
 * User-context Jira client for UI Kit resolvers.
 */
export function createUserJira() {
  return createJira(() => api.asUser());
}

function createJira(context) {
  return {
    /** @param {string} sprintId */
    async getSprint(sprintId) {
      const label = 'GET /rest/agile/1.0/sprint/{sprintId}';
      const response = await sendWithRetry(label, () =>
        context().requestJira(route`/rest/agile/1.0/sprint/${sprintId}`),
      );
      return readJson(response, label);
    },

    /**
     * @param {string} boardId
     * @param {number} startAt
     * @param {number} maxResults
     */
    async getClosedSprints(boardId, startAt, maxResults) {
      const label = 'GET /rest/agile/1.0/board/{boardId}/sprint';
      const params = new URLSearchParams({
        state: 'closed',
        startAt: String(startAt),
        maxResults: String(maxResults),
      });
      const response = await sendWithRetry(label, () =>
        context().requestJira(route`/rest/agile/1.0/board/${boardId}/sprint?${params}`),
      );
      return readJson(response, label);
    },

    async getFields() {
      const label = 'GET /rest/api/3/field';
      const response = await sendWithRetry(label, () => context().requestJira(route`/rest/api/3/field`));
      return readJson(response, label);
    },

    async getStatuses() {
      const label = 'GET /rest/api/3/status';
      const response = await sendWithRetry(label, () => context().requestJira(route`/rest/api/3/status`));
      return readJson(response, label);
    },

    /**
     * @param {object} body
     */
    async searchJql(body) {
      const label = 'POST /rest/api/3/search/jql';
      const response = await sendWithRetry(label, () =>
        context().requestJira(route`/rest/api/3/search/jql`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      return readJson(response, label);
    },

    /**
     * @param {object} body
     * @returns {Promise<{ ok: true, body: object } | { ok: false, status: number }>}
     */
    async bulkChangelogs(body) {
      const label = 'POST /rest/api/3/changelog/bulkfetch';
      const response = await sendWithRetry(label, () =>
        context().requestJira(route`/rest/api/3/changelog/bulkfetch`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      if (response.status === 400 || response.status === 404 || response.status === 410 || response.status === 501) {
        await drain(response);
        return { ok: false, status: response.status };
      }
      return { ok: true, body: await readJson(response, label) };
    },

    /**
     * @param {string} issueIdOrKey
     * @param {number} startAt
     * @param {number} maxResults
     */
    async getIssueChangelog(issueIdOrKey, startAt, maxResults) {
      const label = 'GET /rest/api/3/issue/{issueIdOrKey}/changelog';
      const params = new URLSearchParams({
        startAt: String(startAt),
        maxResults: String(maxResults),
      });
      const response = await sendWithRetry(label, () =>
        context().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/changelog?${params}`),
      );
      return readJson(response, label);
    },
  };
}
