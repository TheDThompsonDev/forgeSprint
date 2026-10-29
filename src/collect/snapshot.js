/**
 * @typedef {object} SprintSnapshot
 * @property {1} schemaVersion
 * @property {string} sprintId
 * @property {string} collectedAt
 * @property {boolean} truncated
 * @property {ReturnType<import('./sprints.js').normalizeSprint>} sprint
 * @property {string} boardId
 * @property {{ id: string, key: string }} project
 * @property {string} sprintFieldId
 * @property {string} flaggedFieldId
 * @property {string} storyPointsFieldId
 * @property {object[]} recentClosedSprints
 * @property {object[]} issues
 * @property {string[]} committedIssueIds
 * @property {Record<string, object[]>} changelogs
 * @property {string[]} warnings
 */

/**
 * Build the typed snapshot stored in KVS. Nested nulls are omitted because
 * the Key-Value Store rejects null.
 * @param {object} input
 * @returns {SprintSnapshot}
 */
export function assembleSnapshot(input) {
  const sprint = input.sprint;
  const fieldIds = {
    storyPointsFieldId: input.storyPointsFieldId,
    flaggedFieldId: input.flaggedFieldId,
  };
  const issues = (input.issues || []).map((raw) =>
    raw && raw.status && raw.issueType ? raw : slimIssue(raw, fieldIds),
  );
  const project = input.project?.key ? input.project : majorityProject(issues);
  return {
    schemaVersion: 1,
    sprintId: String(input.sprintId),
    collectedAt: input.collectedAt,
    truncated: Boolean(input.truncated),
    sprint,
    boardId: input.boardId || sprint?.originBoardId || '',
    project,
    sprintFieldId: input.sprintFieldId || '',
    flaggedFieldId: input.flaggedFieldId || '',
    storyPointsFieldId: input.storyPointsFieldId || '',
    recentClosedSprints: input.recentClosedSprints || [],
    issues,
    committedIssueIds: [...new Set((input.committedIssueIds || []).map(String))],
    changelogs: input.changelogs || {},
    warnings: input.warnings || [],
  };
}

/**
 * @param {Record<string, unknown>} raw
 * @param {{ storyPointsFieldId?: string, flaggedFieldId?: string }} fieldIds
 */
export function slimIssue(raw, fieldIds = {}) {
  const fields = raw?.fields || {};
  const status = fields.status || {};
  const category = status.statusCategory || {};
  const issueType = fields.issuetype || {};
  const project = fields.project || {};
  /** @type {Record<string, unknown>} */
  const issue = {
    id: String(raw.id),
    key: raw.key || '',
    summary: typeof fields.summary === 'string' ? fields.summary : '',
    status: {
      id: status.id != null ? String(status.id) : '',
      name: status.name || '',
      categoryKey: category.key || '',
      categoryName: category.name || '',
    },
    issueType: {
      id: issueType.id != null ? String(issueType.id) : '',
      name: issueType.name || '',
      subtask: Boolean(issueType.subtask),
    },
    project: {
      id: project.id != null ? String(project.id) : '',
      key: project.key || '',
    },
    fixVersions: Array.isArray(fields.fixVersions)
      ? fields.fixVersions.map((version) => ({
          id: version?.id != null ? String(version.id) : '',
          name: version?.name || '',
        }))
      : [],
    issueLinks: Array.isArray(fields.issuelinks) ? fields.issuelinks.map(slimLink) : [],
    flagged: isFlagged(fields[fieldIds.flaggedFieldId]),
  };
  if (fields.priority && fields.priority.name) {
    issue.priority = {
      id: fields.priority.id != null ? String(fields.priority.id) : '',
      name: fields.priority.name,
    };
  }
  if (fields.assignee && fields.assignee.accountId) {
    issue.assigneeAccountId = fields.assignee.accountId;
  }
  if (fields.parent && (fields.parent.id != null || fields.parent.key)) {
    issue.parent = {
      id: fields.parent.id != null ? String(fields.parent.id) : '',
      key: fields.parent.key || '',
      summary: fields.parent.fields?.summary || '',
    };
  }
  const points = fieldIds.storyPointsFieldId ? fields[fieldIds.storyPointsFieldId] : undefined;
  if (typeof points === 'number' && Number.isFinite(points)) {
    issue.storyPoints = points;
  }
  return issue;
}

function slimLink(link) {
  return {
    id: link?.id != null ? String(link.id) : '',
    typeName: link?.type?.name || '',
    inward: link?.type?.inward || '',
    outward: link?.type?.outward || '',
    inwardIssue: slimLinkIssue(link?.inwardIssue),
    outwardIssue: slimLinkIssue(link?.outwardIssue),
  };
}

function slimLinkIssue(issue) {
  if (!issue) {
    return { id: '', key: '' };
  }
  return {
    id: issue.id != null ? String(issue.id) : '',
    key: issue.key || '',
  };
}

function isFlagged(value) {
  return Array.isArray(value) && value.length > 0;
}

function majorityProject(issues) {
  /** @type {Map<string, { id: string, key: string, count: number }>} */
  const counts = new Map();
  for (const issue of issues) {
    const key = issue.project?.key;
    if (!key) {
      continue;
    }
    const current = counts.get(key) || { id: issue.project.id || '', key, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  const ranked = [...counts.values()].sort((left, right) => right.count - left.count);
  if (ranked.length === 0) {
    return { id: '', key: '' };
  }
  return { id: ranked[0].id, key: ranked[0].key };
}

/**
 * Keep changelog items for the sprint field, status, and flagged field.
 * Author display names are dropped; accountId is enough for "by whom".
 * @param {Array<Record<string, unknown>>} histories
 * @param {{ sprintFieldId?: string, flaggedFieldId?: string }} fieldIds
 */
export function slimChangelogs(histories, fieldIds) {
  const wanted = new Set(['status', fieldIds.sprintFieldId, fieldIds.flaggedFieldId].filter(Boolean));
  return (histories || []).map((history) => {
    const items = (history.items || []).filter((item) => wanted.has(item.fieldId) || wanted.has(item.field));
    if (items.length === 0) {
      return null;
    }
    /** @type {Record<string, unknown>} */
    const slim = {
      id: history.id != null ? String(history.id) : '',
      created: history.created || '',
      items: items.map((item) => ({
        field: item.field || '',
        fieldId: item.fieldId || '',
        fieldtype: item.fieldtype || '',
        from: item.from || '',
        fromString: item.fromString || '',
        to: item.to || '',
        toString: item.toString || '',
      })),
    };
    if (history.author?.accountId) {
      slim.authorAccountId = history.author.accountId;
    }
    return slim;
  }).filter(Boolean);
}
