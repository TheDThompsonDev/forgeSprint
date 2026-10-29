/**
 * Pick the Sprint, Flagged, and story points fields from GET /rest/api/3/field.
 * Matching uses documented `clauseNames` and `name`. The `jsw-story-points`
 * schema custom value is only a tie-break and is not confirmed in the OpenAPI schema.
 * @param {Array<{ id?: string, name?: string, clauseNames?: string[], schema?: { custom?: string } }>} fields
 */
export function pickFields(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const warnings = [];

  const sprint = list.filter((field) => hasClause(field, 'sprint'));
  const flagged = list.filter((field) => hasClause(field, 'flagged'));
  const storyByName = list.filter((field) => /^(story points|story point estimate)$/i.test(field.name || ''));
  const storyTyped = storyByName.filter((field) =>
    String(field.schema?.custom || '').includes('jsw-story-points'),
  );
  const story = storyTyped.length > 0 ? storyTyped : storyByName;

  if (sprint.length === 0) {
    warnings.push('No field with clause name "sprint" was found.');
  } else if (sprint.length > 1) {
    warnings.push(`Found ${sprint.length} fields with clause name "sprint"; using ${sprint[0].id}.`);
  }
  if (flagged.length === 0) {
    warnings.push('No field with clause name "flagged" was found.');
  }
  if (story.length === 0) {
    warnings.push('No Story Points or Story point estimate field was found. Counts will be used later.');
  } else if (story.length > 1) {
    warnings.push(`Found ${story.length} story points fields; using ${story[0].id}.`);
  }

  return {
    sprintFieldId: sprint[0]?.id || '',
    flaggedFieldId: flagged[0]?.id || '',
    storyPointsFieldId: story[0]?.id || '',
    warnings,
  };
}

function hasClause(field, clause) {
  return (field.clauseNames || []).some((name) => String(name).toLowerCase() === clause);
}

/**
 * Closed sprints embedded on issues. The sprint custom field value shape is
 * not in the Jira platform OpenAPI schema; this accepts objects with an id
 * and a closed state.
 * @param {unknown} fieldValue
 */
export function closedSprintsFromField(fieldValue) {
  const values = Array.isArray(fieldValue) ? fieldValue : [];
  return values
    .filter((sprint) => sprint && typeof sprint === 'object' && sprint.id != null)
    .filter((sprint) => String(sprint.state || '').toLowerCase() === 'closed')
    .map((sprint) => ({
      id: String(sprint.id),
      name: sprint.name || '',
      state: sprint.state || '',
      completeDate: sprint.completeDate || '',
      endDate: sprint.endDate || '',
      startDate: sprint.startDate || '',
      boardId: sprint.boardId != null ? String(sprint.boardId) : sprint.originBoardId != null ? String(sprint.originBoardId) : '',
    }));
}

/**
 * @param {Array<{ fields?: Record<string, unknown> }>} issues
 * @param {string} sprintFieldId
 */
export function latestClosedSprint(issues, sprintFieldId) {
  if (!sprintFieldId) {
    return null;
  }
  /** @type {Map<string, ReturnType<typeof closedSprintsFromField>[number]>} */
  const byId = new Map();
  for (const issue of issues || []) {
    for (const sprint of closedSprintsFromField(issue?.fields?.[sprintFieldId])) {
      byId.set(sprint.id, sprint);
    }
  }
  const ranked = [...byId.values()].sort((left, right) => compareInstant(right.completeDate || right.endDate, left.completeDate || left.endDate));
  return ranked[0] || null;
}

function compareInstant(left, right) {
  const leftMs = Date.parse(left || '');
  const rightMs = Date.parse(right || '');
  if (Number.isNaN(leftMs) && Number.isNaN(rightMs)) {
    return 0;
  }
  if (Number.isNaN(leftMs)) {
    return -1;
  }
  if (Number.isNaN(rightMs)) {
    return 1;
  }
  return leftMs - rightMs;
}
