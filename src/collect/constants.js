/** In-process wait cap. Longer Retry-After values are handed back to the async consumer. */
export const MAX_INLINE_WAIT_MS = 30_000;

/** Attempts per Jira call, including the first. */
export const MAX_ATTEMPTS = 5;

export const ISSUE_PAGE_SIZE = 100;
export const MAX_ISSUE_PAGES = 20;
export const MAX_ISSUES = ISSUE_PAGE_SIZE * MAX_ISSUE_PAGES;

export const SPRINT_PAGE_SIZE = 50;
export const MAX_SPRINT_PAGES = 20;

/** Under the bulkfetch max of 1000 issue ids per request. */
export const BULK_ISSUE_BATCH = 100;

/** Under the bulkfetch maxResults maximum of 10000. */
export const BULK_CHANGELOG_PAGE_SIZE = 1000;
export const MAX_BULK_CHANGELOG_PAGES = 50;

export const ISSUE_CHANGELOG_PAGE_SIZE = 100;
export const MAX_ISSUE_CHANGELOG_PAGES = 20;

/** Parallel per-issue changelog calls when bulkfetch is unavailable. */
export const CHANGELOG_CONCURRENCY = 4;

/** Stay under the 240 KiB KVS value limit. */
export const MAX_KVS_PART_CHARS = 200_000;

/** Skip the committed-at-start JQL if the status list makes it this long. */
export const MAX_JQL_CHARS = 8_000;

export const RECENT_CLOSED_SPRINTS = 3;
export const PROJECT_JOB_LIMIT = 25;
