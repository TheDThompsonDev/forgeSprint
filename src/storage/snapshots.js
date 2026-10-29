import { kvs } from '@forge/kvs';
import { PROJECT_JOB_LIMIT } from '../collect/constants.js';
import { packValue, unpackValue } from './chunk.js';

export function jobKey(jobId) {
  return `job:${jobId}`;
}

export function snapshotKey(sprintId) {
  return `snapshot:sprint-${sprintId}`;
}

function partKey(sprintId, index) {
  return `snapshot:sprint-${sprintId}:part:${index}`;
}

export function projectKey(projectKeyValue) {
  return `project:${projectKeyValue}`;
}

/**
 * @param {string} sprintId
 * @param {object} snapshot
 */
export async function saveSnapshot(sprintId, snapshot) {
  const key = snapshotKey(sprintId);
  const previous = await kvs.get(key);
  const packed = packValue(snapshot);
  if (!packed.chunked) {
    await kvs.set(key, snapshot);
  } else {
    await kvs.set(key, {
      schemaVersion: 1,
      sprintId: String(sprintId),
      chunked: true,
      encoding: 'base64',
      partCount: packed.parts.length,
      bytes: packed.bytes,
    });
    for (let index = 0; index < packed.parts.length; index += 1) {
      await kvs.set(partKey(sprintId, index), packed.parts[index]);
    }
  }
  const previousCount = previous?.chunked ? previous.partCount : 0;
  const nextCount = packed.chunked ? packed.parts.length : 0;
  for (let index = nextCount; index < previousCount; index += 1) {
    await kvs.delete(partKey(sprintId, index));
  }
  return { chunked: packed.chunked, bytes: packed.bytes, partCount: nextCount };
}

/** @param {string} sprintId */
export async function loadSnapshot(sprintId) {
  const record = await kvs.get(snapshotKey(sprintId));
  if (!record) {
    return undefined;
  }
  if (!record.chunked) {
    return record;
  }
  const parts = [];
  for (let index = 0; index < record.partCount; index += 1) {
    const part = await kvs.get(partKey(sprintId, index));
    parts.push(typeof part === 'string' ? part : '');
  }
  return unpackValue(record, parts);
}

/**
 * @param {string} keyValue
 * @param {string} sprintId
 */
export async function rememberProjectSprint(keyValue, sprintId) {
  if (!keyValue) {
    return;
  }
  const key = projectKey(keyValue);
  const current = (await kvs.get(key)) || { sprintIds: [] };
  const sprintIds = [
    String(sprintId),
    ...(current.sprintIds || []).filter((id) => id !== String(sprintId)),
  ].slice(0, PROJECT_JOB_LIMIT);
  await kvs.set(key, { latestSprintId: String(sprintId), sprintIds });
}

/** @param {string} keyValue */
export async function listProjectJobs(keyValue) {
  if (!keyValue) {
    return [];
  }
  const index = await kvs.get(projectKey(keyValue));
  const jobs = [];
  for (const sprintId of index?.sprintIds || []) {
    const job = await kvs.get(jobKey(`sprint-${sprintId}`));
    if (job) {
      jobs.push(publicJob(job));
    }
  }
  return jobs;
}

/** Status only. Issue text stays in the snapshot. */
export function publicJob(job) {
  return {
    jobId: job.jobId || '',
    sprintId: job.sprintId || '',
    sprintName: job.sprintName || '',
    projectKey: job.projectKey || '',
    status: job.status || '',
    source: job.source || '',
    issueCount: job.issueCount || 0,
    committedCount: job.committedCount || 0,
    warningCount: job.warningCount || 0,
    warnings: Array.isArray(job.warnings) ? job.warnings : [],
    chunked: Boolean(job.chunked),
    updatedAt: job.updatedAt || '',
    collectedAt: job.collectedAt || '',
    error: job.error || '',
  };
}
