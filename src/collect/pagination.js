/**
 * Enhanced issue search (POST /rest/api/3/search/jql) stops when `isLast`
 * is true or `nextPageToken` is missing. The token is null on the last page.
 * @param {{ isLast?: boolean, nextPageToken?: string | null }} page
 * @returns {string | null}
 */
export function nextSearchToken(page) {
  if (!page || page.isLast === true) {
    return null;
  }
  if (typeof page.nextPageToken !== 'string' || page.nextPageToken.length === 0) {
    return null;
  }
  return page.nextPageToken;
}

/**
 * Bulk changelog (POST /rest/api/3/changelog/bulkfetch) has `nextPageToken`
 * and no `isLast` property in the OpenAPI schema.
 * @param {{ nextPageToken?: string | null }} page
 * @returns {string | null}
 */
export function nextBulkToken(page) {
  if (!page || typeof page.nextPageToken !== 'string' || page.nextPageToken.length === 0) {
    return null;
  }
  return page.nextPageToken;
}

/**
 * Agile board sprint list uses startAt / isLast, not a page token.
 * @param {{ startAt?: number, isLast?: boolean, values?: unknown[] }} page
 * @returns {number | null}
 */
export function nextStartAt(page) {
  if (!page || page.isLast === true) {
    return null;
  }
  const values = Array.isArray(page.values) ? page.values : [];
  if (values.length === 0) {
    return null;
  }
  const startAt = Number(page.startAt) || 0;
  return startAt + values.length;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<unknown>} fn
 */
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
