/** Stable app-level id. The queue's own job id is separate. */
export function jobIdForSprint(sprintId) {
  return `sprint-${sprintId}`;
}
