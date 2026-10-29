import { readSprintEvent } from '../collect/sprints.js';
import { enqueueSprintJob } from '../jobs/enqueue.js';

/**
 * Product trigger for avi:jira-software:closed:sprint.
 * Returns as soon as the job is queued. Collection runs in the consumer.
 * @param {unknown} event
 */
export async function onSprintClosed(event) {
  const sprint = readSprintEvent(event);
  if (!sprint) {
    console.log('Sprint closed event had no sprint id');
    return;
  }
  const result = await enqueueSprintJob({
    sprintId: sprint.id,
    source: 'trigger',
    sprint: { name: sprint.name, originBoardId: sprint.originBoardId },
  });
  console.log(
    `Sprint ${sprint.id} ${result.enqueued ? 'queued' : 'already collected'} as ${result.jobId}`,
  );
}
