import { RECENT_CLOSED_SPRINTS } from './constants.js';

/**
 * @param {Record<string, unknown> | null | undefined} sprint
 */
export function normalizeSprint(sprint) {
  if (!sprint || sprint.id == null) {
    return null;
  }
  return {
    id: String(sprint.id),
    originBoardId: sprint.originBoardId != null ? String(sprint.originBoardId) : '',
    name: typeof sprint.name === 'string' ? sprint.name : '',
    goal: typeof sprint.goal === 'string' ? sprint.goal : '',
    state: typeof sprint.state === 'string' ? sprint.state : '',
    startDate: typeof sprint.startDate === 'string' ? sprint.startDate : '',
    endDate: typeof sprint.endDate === 'string' ? sprint.endDate : '',
    completeDate: typeof sprint.completeDate === 'string' ? sprint.completeDate : '',
  };
}

/**
 * Product trigger payload documented for avi:jira-software:*:sprint.
 * @param {unknown} event
 */
export function readSprintEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  return normalizeSprint(/** @type {{ sprint?: Record<string, unknown> }} */ (event).sprint);
}

/**
 * Last N closed sprints by completeDate, plus the current sprint once.
 * @param {Array<Record<string, unknown>>} closedSprints
 * @param {ReturnType<typeof normalizeSprint>} current
 */
export function selectTrendSprints(closedSprints, current) {
  const byId = new Map();
  for (const sprint of closedSprints || []) {
    const normalized = normalizeSprint(sprint);
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  }
  if (current) {
    byId.set(current.id, { ...byId.get(current.id), ...current });
  }
  const others = [...byId.values()]
    .filter((sprint) => !current || sprint.id !== current.id)
    .sort((left, right) => compareDate(left.completeDate, right.completeDate));
  const previous = others.slice(-RECENT_CLOSED_SPRINTS);
  return current ? [...previous, current] : previous;
}

function compareDate(left, right) {
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
