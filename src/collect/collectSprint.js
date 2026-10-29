import {
  BULK_CHANGELOG_PAGE_SIZE,
  BULK_ISSUE_BATCH,
  CHANGELOG_CONCURRENCY,
  ISSUE_CHANGELOG_PAGE_SIZE,
  ISSUE_PAGE_SIZE,
  MAX_BULK_CHANGELOG_PAGES,
  MAX_ISSUE_CHANGELOG_PAGES,
  MAX_ISSUE_PAGES,
  MAX_ISSUES,
  MAX_SPRINT_PAGES,
  SPRINT_PAGE_SIZE,
} from './constants.js';
import { pickFields } from './fields.js';
import { committedAtStartJql, issuesInSprintJql, startDay } from './jql.js';
import { mapPool, nextBulkToken, nextSearchToken, nextStartAt } from './pagination.js';
import { assembleSnapshot, slimChangelogs, slimIssue } from './snapshot.js';
import { normalizeSprint, selectTrendSprints } from './sprints.js';

/**
 * Collect a sprint snapshot using an injected Jira client.
 * The client is `asApp()` in the consumer and is not called from the trigger.
 * @param {object} options
 * @param {string} options.sprintId
 * @param {string} [options.boardIdHint]
 * @param {object} [options.sprintHint]
 * @param {object} options.jira
 * @param {string} [options.collectedAt]
 */
export async function collectSprintSnapshot(options) {
  const warnings = [];
  const sprintResponse = await options.jira.getSprint(options.sprintId);
  const sprint = normalizeSprint(sprintResponse) || normalizeSprint(options.sprintHint);
  if (!sprint) {
    throw new Error(`Sprint ${options.sprintId} was not returned by the sprint API`);
  }

  const boardId = sprint.originBoardId || options.boardIdHint || '';
  const recentClosedSprints = await loadRecentSprints(options.jira, boardId, sprint, warnings);
  const fieldCatalog = await options.jira.getFields();
  const fields = pickFields(fieldCatalog);
  warnings.push(...fields.warnings);

  const requestedFields = [
    'summary',
    'status',
    'issuetype',
    'priority',
    'assignee',
    'parent',
    'fixVersions',
    'issuelinks',
    'project',
  ];
  if (fields.storyPointsFieldId) {
    requestedFields.push(fields.storyPointsFieldId);
  }
  if (fields.flaggedFieldId) {
    requestedFields.push(fields.flaggedFieldId);
  }

  const issueSearch = await searchAllIssues(options.jira, issuesInSprintJql(sprint.id), requestedFields);
  if (issueSearch.truncated) {
    warnings.push(`Stopped after ${MAX_ISSUES} issues in the sprint.`);
  }
  const issues = issueSearch.issues.map((issue) => slimIssue(issue, fields));

  const statuses = await options.jira.getStatuses();
  const statusNames = (Array.isArray(statuses) ? statuses : [])
    .map((status) => status?.name)
    .filter((name) => typeof name === 'string' && name.length > 0);
  const committedQuery = committedAtStartJql(sprint.id, statusNames, startDay(sprint.startDate));
  let committedIssueIds = [];
  if ('skipped' in committedQuery) {
    warnings.push(committedQuery.skipped);
  } else {
    const committed = await searchAllIssues(options.jira, committedQuery.jql, ['id', 'key']);
    committedIssueIds = committed.issues.map((issue) => String(issue.id));
    if (committed.truncated) {
      warnings.push(`Stopped after ${MAX_ISSUES} committed-at-start issues.`);
    }
  }

  const changelogResult = await loadChangelogs(options.jira, issues, fields, warnings);

  return assembleSnapshot({
    sprintId: sprint.id,
    collectedAt: options.collectedAt || new Date().toISOString(),
    truncated: issueSearch.truncated || changelogResult.truncated,
    sprint,
    boardId,
    sprintFieldId: fields.sprintFieldId,
    flaggedFieldId: fields.flaggedFieldId,
    storyPointsFieldId: fields.storyPointsFieldId,
    recentClosedSprints,
    issues,
    committedIssueIds,
    changelogs: changelogResult.changelogs,
    warnings,
  });
}

async function loadRecentSprints(jira, boardId, current, warnings) {
  if (!boardId) {
    warnings.push('Sprint has no origin board, so the previous closed sprints were not loaded.');
    return current ? [current] : [];
  }
  /** @type {object[]} */
  const closed = [];
  let startAt = 0;
  for (let page = 0; page < MAX_SPRINT_PAGES; page += 1) {
    const body = await jira.getClosedSprints(boardId, startAt, SPRINT_PAGE_SIZE);
    closed.push(...(body?.values || []));
    const next = nextStartAt(body);
    if (next == null) {
      return selectTrendSprints(closed, current);
    }
    startAt = next;
  }
  warnings.push(`Stopped after ${MAX_SPRINT_PAGES} pages of closed sprints.`);
  return selectTrendSprints(closed, current);
}

async function searchAllIssues(jira, jql, fields) {
  /** @type {object[]} */
  const issues = [];
  let token;
  let truncated = false;
  for (let page = 0; page < MAX_ISSUE_PAGES; page += 1) {
    const body = await jira.searchJql({
      jql,
      fields,
      maxResults: ISSUE_PAGE_SIZE,
      ...(token ? { nextPageToken: token } : {}),
    });
    issues.push(...(body?.issues || []));
    const next = nextSearchToken(body);
    if (!next) {
      break;
    }
    if (issues.length >= MAX_ISSUES || page === MAX_ISSUE_PAGES - 1) {
      truncated = true;
      break;
    }
    token = next;
  }
  return { issues: issues.slice(0, MAX_ISSUES), truncated };
}

async function loadChangelogs(jira, issues, fields, warnings) {
  /** @type {Record<string, object[]>} */
  const changelogs = {};
  const ids = issues.map((issue) => issue.id).filter(Boolean);
  if (ids.length === 0) {
    return { changelogs, truncated: false };
  }

  const fieldIds = ['status', fields.sprintFieldId, fields.flaggedFieldId].filter(Boolean).slice(0, 10);
  let bulkUnavailable = false;
  let truncated = false;

  for (let offset = 0; offset < ids.length && !bulkUnavailable; offset += BULK_ISSUE_BATCH) {
    const batch = ids.slice(offset, offset + BULK_ISSUE_BATCH);
    let pageToken;
    for (let page = 0; page < MAX_BULK_CHANGELOG_PAGES; page += 1) {
      const result = await jira.bulkChangelogs({
        issueIdsOrKeys: batch,
        fieldIds,
        maxResults: BULK_CHANGELOG_PAGE_SIZE,
        ...(pageToken ? { nextPageToken: pageToken } : {}),
      });
      if (!result.ok) {
        bulkUnavailable = true;
        warnings.push(
          `Changelog bulkfetch returned HTTP ${result.status}. Falling back to per-issue changelogs.`,
        );
        break;
      }
      appendBulk(changelogs, result.body, fields);
      const next = nextBulkToken(result.body);
      if (!next) {
        break;
      }
      if (page === MAX_BULK_CHANGELOG_PAGES - 1) {
        truncated = true;
        warnings.push('Stopped early while paging bulk changelogs.');
        break;
      }
      pageToken = next;
    }
  }

  if (!bulkUnavailable) {
    return { changelogs, truncated };
  }

  const fallback = {};
  let fallbackTruncated = false;
  await mapPool(issues, CHANGELOG_CONCURRENCY, async (issue) => {
    const loaded = await loadOneChangelog(jira, issue.id, fields);
    fallback[issue.id] = loaded.histories;
    if (loaded.truncated) {
      fallbackTruncated = true;
    }
  });
  if (fallbackTruncated) {
    warnings.push('Stopped early while paging at least one issue changelog.');
  }
  return { changelogs: fallback, truncated: truncated || fallbackTruncated };
}

function appendBulk(target, body, fields) {
  for (const entry of body?.issueChangeLogs || []) {
    const issueId = entry?.issueId != null ? String(entry.issueId) : '';
    if (!issueId) {
      continue;
    }
    const slim = slimChangelogs(entry.changeHistories || [], fields);
    target[issueId] = (target[issueId] || []).concat(slim);
  }
}

async function loadOneChangelog(jira, issueId, fields) {
  /** @type {object[]} */
  const histories = [];
  let startAt = 0;
  for (let page = 0; page < MAX_ISSUE_CHANGELOG_PAGES; page += 1) {
    const body = await jira.getIssueChangelog(issueId, startAt, ISSUE_CHANGELOG_PAGE_SIZE);
    histories.push(...slimChangelogs(body?.values || [], fields));
    const values = body?.values || [];
    if (body?.isLast === true || values.length === 0) {
      return { histories, truncated: false };
    }
    startAt += values.length;
  }
  return { histories, truncated: true };
}
