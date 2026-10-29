import { InvocationError, InvocationErrorCode } from '@forge/events';
import { kvs } from '@forge/kvs';
import { collectSprintSnapshot } from '../collect/collectSprint.js';
import { RateLimitError, createAppJira } from '../collect/jira.js';
import { jobKey, rememberProjectSprint, saveSnapshot } from '../storage/snapshots.js';

/**
 * Async consumer. Phase 1 collects the sprint and stores a SprintSnapshot.
 * Later phases continue from the saved snapshot; they are not implemented here.
 * @param {{ body?: { jobId?: string, force?: boolean }, retryContext?: { retryCount?: number } }} event
 */
export async function consumeReview(event) {
  const jobId = event?.body?.jobId;
  if (!jobId || typeof jobId !== 'string') {
    console.log('Sprint consumer ignored an event with no jobId');
    return undefined;
  }

  const key = jobKey(jobId);
  const existing = await kvs.get(key);
  if (existing?.status === 'collected' && !event.body?.force) {
    console.log(`Sprint job ${jobId} already collected`);
    return undefined;
  }

  const sprintId = existing?.sprintId || jobId.replace(/^sprint-/, '');
  const now = new Date().toISOString();
  await kvs.set(key, {
    ...(existing || { jobId, sprintId, createdAt: now }),
    jobId,
    sprintId,
    status: 'collecting',
    updatedAt: now,
    error: '',
  });

  try {
    const snapshot = await collectSprintSnapshot({
      sprintId,
      boardIdHint: existing?.boardId || '',
      sprintHint: existing
        ? { id: sprintId, name: existing.sprintName, originBoardId: existing.boardId }
        : undefined,
      jira: createAppJira(),
    });
    const stored = await saveSnapshot(sprintId, snapshot);
    if (snapshot.project?.key) {
      await rememberProjectSprint(snapshot.project.key, sprintId);
    }
    await kvs.set(key, {
      jobId,
      sprintId,
      status: 'collected',
      source: existing?.source || '',
      sprintName: snapshot.sprint?.name || existing?.sprintName || '',
      boardId: snapshot.boardId || '',
      projectKey: snapshot.project?.key || '',
      issueCount: snapshot.issues.length,
      committedCount: snapshot.committedIssueIds.length,
      warningCount: snapshot.warnings.length,
      warnings: snapshot.warnings,
      chunked: stored.chunked,
      collectedAt: snapshot.collectedAt,
      createdAt: existing?.createdAt || now,
      updatedAt: new Date().toISOString(),
      error: '',
    });
    console.log(
      `Collected sprint ${sprintId}: ${snapshot.issues.length} issues, ${snapshot.warnings.length} warnings, chunked=${stored.chunked}`,
    );
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.name : 'Error';
    const status = error && typeof error === 'object' && 'status' in error ? error.status : '';
    await kvs.set(key, {
      ...(existing || { jobId, sprintId, createdAt: now }),
      jobId,
      sprintId,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      error: status ? `${message} HTTP ${status}` : message,
    });
    console.log(`Sprint job ${jobId} failed: ${message}${status ? ` HTTP ${status}` : ''}`);

    if (error instanceof RateLimitError) {
      const retryAfter = Math.min(900, Math.max(1, Math.ceil(error.retryAfterSeconds || 30)));
      return new InvocationError({
        retryAfter,
        retryReason: InvocationErrorCode.FUNCTION_UPSTREAM_RATE_LIMITED,
        retryData: { jobId, status: 429 },
      });
    }
    if (error && typeof error === 'object' && 'status' in error && Number(error.status) >= 500) {
      throw error;
    }
    return undefined;
  }
}
