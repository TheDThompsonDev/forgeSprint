import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import { jobKey } from '../storage/snapshots.js';
import { jobIdForSprint } from './ids.js';

const queue = new Queue({ key: 'review-queue' });

export { jobIdForSprint };

/**
 * Enqueue `{ jobId }` and record the job in KVS.
 * A sprint that already has a collected snapshot is not enqueued again
 * unless `force` is set. The queue body stays `{ jobId }` for the trigger;
 * `force` is added only for the settings-page button.
 * @param {object} options
 * @param {string} options.sprintId
 * @param {'trigger' | 'settings'} options.source
 * @param {{ name?: string, originBoardId?: string }} [options.sprint]
 * @param {boolean} [options.force]
 */
export async function enqueueSprintJob(options) {
  const sprintId = String(options.sprintId);
  const jobId = jobIdForSprint(sprintId);
  const key = jobKey(jobId);
  const existing = await kvs.get(key);
  if (existing?.status === 'collected' && !options.force) {
    return { jobId, enqueued: false, status: 'collected' };
  }

  const now = new Date().toISOString();
  const status = existing?.status === 'collecting' && !options.force ? 'collecting' : 'queued';
  const record = {
    jobId,
    sprintId,
    status,
    source: options.source,
    sprintName: options.sprint?.name || existing?.sprintName || '',
    boardId: options.sprint?.originBoardId || existing?.boardId || '',
    projectKey: existing?.projectKey || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    issueCount: existing?.issueCount || 0,
    committedCount: existing?.committedCount || 0,
    warningCount: existing?.warningCount || 0,
    warnings: existing?.warnings || [],
    error: '',
  };
  await kvs.set(key, record);

  const pushed = await queue.push({
    body: options.force ? { jobId, force: true } : { jobId },
    concurrency: { key: jobId, limit: 1 },
  });
  await kvs.set(key, {
    ...record,
    queueJobId: pushed.jobId,
    updatedAt: new Date().toISOString(),
  });
  return { jobId, enqueued: true, status: 'queued', queueJobId: pushed.jobId };
}
