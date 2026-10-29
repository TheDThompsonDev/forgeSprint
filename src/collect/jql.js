import { MAX_JQL_CHARS } from './constants.js';

/**
 * Calendar date prefix of a Jira sprint timestamp such as
 * `2015-04-11T15:22:00.000+10:00`. The prefix is the date in the offset
 * Jira already applied. Returns '' when the value has no date prefix.
 * @param {string | undefined} startDate
 */
export function startDay(startDate) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(startDate || '');
  return match ? match[1] : '';
}

/** @param {unknown} value */
export function quoteJql(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** @param {string} sprintId */
export function assertSprintId(sprintId) {
  if (!/^[0-9]+$/.test(String(sprintId))) {
    throw new Error('Sprint id must be numeric');
  }
  return String(sprintId);
}

/** @param {string} sprintId */
export function issuesInSprintJql(sprintId) {
  return `sprint = ${assertSprintId(sprintId)}`;
}

/**
 * Issues that were already on the sprint at the start of the start day.
 * `status WAS IN (<every status>) ON "<day>"` excludes issues added later.
 * @param {string} sprintId
 * @param {string[]} statusNames
 * @param {string} day
 * @returns {{ jql: string } | { skipped: string }}
 */
export function committedAtStartJql(sprintId, statusNames, day) {
  const id = assertSprintId(sprintId);
  if (!day) {
    return { skipped: 'Sprint has no start date, so committed-at-start was skipped.' };
  }
  const names = (statusNames || []).map((name) => String(name)).filter(Boolean);
  if (names.length === 0) {
    return { skipped: 'No Jira statuses were returned, so committed-at-start was skipped.' };
  }
  const jql = `sprint = ${id} AND status WAS IN (${names.map(quoteJql).join(', ')}) ON ${quoteJql(day)}`;
  if (jql.length > MAX_JQL_CHARS) {
    return {
      skipped: `Committed-at-start JQL is ${jql.length} characters, over the ${MAX_JQL_CHARS} safety cap, so it was skipped.`,
    };
  }
  return { jql };
}
