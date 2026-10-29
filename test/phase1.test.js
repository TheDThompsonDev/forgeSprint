import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { collectSprintSnapshot } from '../src/collect/collectSprint.js';
import { latestClosedSprint, pickFields } from '../src/collect/fields.js';
import { committedAtStartJql, issuesInSprintJql, quoteJql, startDay } from '../src/collect/jql.js';
import { nextBulkToken, nextSearchToken, nextStartAt } from '../src/collect/pagination.js';
import { parseRetryAfterSeconds, retryDelayMs, shouldDeferRateLimit } from '../src/collect/retry.js';
import { assembleSnapshot } from '../src/collect/snapshot.js';
import { readSprintEvent, selectTrendSprints } from '../src/collect/sprints.js';
import { jobIdForSprint } from '../src/jobs/ids.js';
import { packValue, unpackValue } from '../src/storage/chunk.js';

test('sprint closed payload keeps the documented sprint fields and drops atlassianId', () => {
  const sprint = readSprintEvent({
    eventType: 'avi:jira-software:closed:sprint',
    sprint: {
      id: '6',
      originBoardId: '12',
      name: 'EX1 Sprint 1',
      goal: 'Ship the review',
      state: 'closed',
      startDate: '2026-10-01T09:00:00.000+0200',
      endDate: '2026-10-14T18:00:00.000+0200',
      completeDate: '2026-10-14T18:05:00.000+0200',
    },
    atlassianId: '5c37e3bdb393bf4ce95658d5',
  });
  assert.equal(sprint.id, '6');
  assert.equal(sprint.originBoardId, '12');
  assert.equal(startDay(sprint.startDate), '2026-10-01');
  assert.equal('atlassianId' in sprint, false);
  assert.equal(readSprintEvent({}), null);
});

test('committed-at-start JQL quotes status names and the start day', () => {
  const query = committedAtStartJql('42', ['To Do', 'In "Review"'], '2026-10-01');
  assert.equal(
    query.jql,
    'sprint = 42 AND status WAS IN ("To Do", "In \\"Review\\"") ON "2026-10-01"',
  );
  assert.equal(issuesInSprintJql('42'), 'sprint = 42');
  assert.equal(quoteJql('a\\b'), '"a\\\\b"');
  assert.match(committedAtStartJql('42', [], '2026-10-01').skipped, /statuses/);
  assert.throws(() => issuesInSprintJql('42; drop'), /numeric/);
});

test('retry delay treats Retry-After seconds as the minimum', () => {
  assert.equal(parseRetryAfterSeconds('12'), 12);
  assert.equal(parseRetryAfterSeconds('soon'), undefined);
  const delay = retryDelayMs({ attempt: 0, retryAfterSeconds: 30, random: () => 0 });
  assert.equal(delay, 30_000);
  const shortHeader = retryDelayMs({ attempt: 4, retryAfterSeconds: 1, random: () => 0 });
  assert.ok(shortHeader > 1_000);
  assert.equal(shouldDeferRateLimit(31), true);
  assert.equal(shouldDeferRateLimit(2), false);
});

test('pagination follows the documented cursors', () => {
  assert.equal(nextSearchToken({ isLast: false, nextPageToken: 'abc' }), 'abc');
  assert.equal(nextSearchToken({ isLast: true, nextPageToken: 'abc' }), null);
  assert.equal(nextSearchToken({ isLast: false, nextPageToken: null }), null);
  assert.equal(nextBulkToken({ nextPageToken: 'next' }), 'next');
  assert.equal(nextBulkToken({}), null);
  assert.equal(nextStartAt({ startAt: 0, isLast: false, values: [{}, {}] }), 2);
  assert.equal(nextStartAt({ startAt: 2, isLast: true, values: [{}] }), null);
  assert.equal(nextStartAt({ startAt: 0, isLast: false, values: [] }), null);
});

test('field discovery uses clause names and story points names', () => {
  const picked = pickFields([
    { id: 'customfield_10020', name: 'Sprint', clauseNames: ['cf[10020]', 'sprint'] },
    { id: 'customfield_10021', name: 'Flagged', clauseNames: ['flagged'] },
    { id: 'customfield_10016', name: 'Story Points', clauseNames: ['Story Points'], schema: { custom: 'com.pyxis.greenhopper.jira:jsw-story-points' } },
    { id: 'customfield_10099', name: 'Story Points', clauseNames: ['cf[10099]'] },
  ]);
  assert.equal(picked.sprintFieldId, 'customfield_10020');
  assert.equal(picked.flaggedFieldId, 'customfield_10021');
  assert.equal(picked.storyPointsFieldId, 'customfield_10016');
});

test('trend sprints keep the current sprint plus the three most recently completed', () => {
  const current = { id: '5', name: 'Current', completeDate: '2026-10-14T00:00:00.000Z', originBoardId: '1' };
  const closed = [1, 2, 3, 4].map((id) => ({
    id,
    name: `S${id}`,
    state: 'closed',
    completeDate: `2026-0${id}-01T00:00:00.000Z`,
    originBoardId: 1,
  }));
  const trend = selectTrendSprints(closed, current);
  assert.deepEqual(trend.map((sprint) => sprint.id), ['2', '3', '4', '5']);
});

test('last closed sprint is chosen from the sprint field on issues', () => {
  const sprint = latestClosedSprint([
    {
      fields: {
        customfield_10020: [
          { id: 1, name: 'Old', state: 'closed', completeDate: '2026-09-01T00:00:00.000Z', boardId: 9 },
          { id: 2, name: 'New', state: 'closed', completeDate: '2026-10-01T00:00:00.000Z', boardId: 9 },
          { id: 3, name: 'Active', state: 'active' },
        ],
      },
    },
  ], 'customfield_10020');
  assert.equal(sprint.id, '2');
  assert.equal(sprint.boardId, '9');
});

test('assembleSnapshot is a stable typed object without nulls', () => {
  const snapshot = assembleSnapshot({
    sprintId: 42,
    collectedAt: '2026-10-14T18:00:00.000Z',
    sprint: {
      id: '42',
      originBoardId: '7',
      name: 'Sprint 42',
      goal: 'Ship it',
      state: 'closed',
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-14T00:00:00.000Z',
      completeDate: '2026-10-14T12:00:00.000Z',
    },
    issues: [
      {
        id: '100',
        key: 'PROJ-1',
        fields: {
          summary: 'Launch checklist',
          status: { id: '1', name: 'Done', statusCategory: { key: 'done', name: 'Done' } },
          issuetype: { id: '2', name: 'Story', subtask: false },
          project: { id: '10', key: 'PROJ' },
          customfield_10016: 5,
          customfield_10021: [{ value: 'Impediment' }],
          parent: { id: '9', key: 'PROJ-9', fields: { summary: 'Launch' } },
          assignee: { accountId: 'abc', displayName: 'A Person' },
        },
      },
    ],
    committedIssueIds: ['100', '100'],
    changelogs: { 100: [] },
    storyPointsFieldId: 'customfield_10016',
    flaggedFieldId: 'customfield_10021',
    warnings: [],
  });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.sprintId, '42');
  assert.equal(snapshot.project.key, 'PROJ');
  assert.equal(snapshot.issues[0].storyPoints, 5);
  assert.equal(snapshot.issues[0].flagged, true);
  assert.equal(snapshot.issues[0].status.categoryKey, 'done');
  assert.equal(snapshot.issues[0].assigneeAccountId, 'abc');
  assert.equal('displayName' in snapshot.issues[0], false);
  assert.deepEqual(snapshot.committedIssueIds, ['100']);
  assert.equal(JSON.stringify(snapshot).includes('null'), false);
});

test('oversized snapshots round-trip through base64 parts', () => {
  const packed = packValue({ text: 'café — sprint' }, 8);
  assert.equal(packed.chunked, true);
  assert.ok(packed.parts.length > 1);
  const restored = unpackValue({ chunked: true }, packed.parts);
  assert.deepEqual(restored, { text: 'café — sprint' });
  const small = packValue({ ok: true }, 200);
  assert.equal(small.chunked, false);
});

test('job id is stable per sprint', () => {
  assert.equal(jobIdForSprint('42'), 'sprint-42');
  assert.equal(jobIdForSprint(42), 'sprint-42');
});

test('collection paginates search, sprints, and bulk changelogs', async () => {
  const calls = [];
  const jira = {
    async getSprint() {
      return {
        id: 42,
        name: 'Sprint 42',
        state: 'closed',
        originBoardId: 7,
        goal: 'Ship it',
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-10-14T00:00:00.000Z',
        completeDate: '2026-10-14T12:00:00.000Z',
      };
    },
    async getClosedSprints(_boardId, startAt) {
      calls.push(['sprints', startAt]);
      if (startAt === 0) {
        return { startAt: 0, isLast: false, values: [{ id: 41, name: 'Previous', state: 'closed', completeDate: '2026-09-30T00:00:00.000Z', originBoardId: 7 }] };
      }
      return { startAt, isLast: true, values: [] };
    },
    async getFields() {
      return [
        { id: 'customfield_10020', name: 'Sprint', clauseNames: ['sprint'] },
        { id: 'customfield_10021', name: 'Flagged', clauseNames: ['flagged'] },
        { id: 'customfield_10016', name: 'Story Points', clauseNames: ['Story Points'] },
      ];
    },
    async getStatuses() {
      return [{ name: 'To Do' }, { name: 'Done' }];
    },
    async searchJql(body) {
      calls.push(['search', body.jql, body.nextPageToken || '']);
      if (body.jql.startsWith('sprint = 42 AND')) {
        return { isLast: true, issues: [{ id: '100', key: 'PROJ-1' }] };
      }
      if (!body.nextPageToken) {
        return {
          isLast: false,
          nextPageToken: 'page-2',
          issues: [{
            id: '100',
            key: 'PROJ-1',
            fields: {
              summary: 'Launch checklist',
              status: { id: '1', name: 'Done', statusCategory: { key: 'done', name: 'Done' } },
              issuetype: { id: '2', name: 'Story' },
              project: { id: '10', key: 'PROJ' },
              customfield_10016: 3,
            },
          }],
        };
      }
      return { isLast: true, issues: [] };
    },
    async bulkChangelogs() {
      calls.push(['bulk']);
      return {
        ok: true,
        body: {
          issueChangeLogs: [{
            issueId: '100',
            changeHistories: [{
              id: '9',
              created: '2026-10-02T00:00:00.000Z',
              author: { accountId: 'user-1', displayName: 'Hidden' },
              items: [{ field: 'status', fieldId: 'status', fromString: 'To Do', toString: 'Done' }],
            }],
          }],
        },
      };
    },
    async getIssueChangelog() {
      throw new Error('per-issue changelog should not run when bulkfetch works');
    },
  };

  const snapshot = await collectSprintSnapshot({
    sprintId: '42',
    jira,
    collectedAt: '2026-10-14T18:00:00.000Z',
  });
  assert.equal(snapshot.issues.length, 1);
  assert.equal(snapshot.issues[0].summary, 'Launch checklist');
  assert.deepEqual(snapshot.committedIssueIds, ['100']);
  assert.equal(snapshot.changelogs['100'][0].authorAccountId, 'user-1');
  assert.equal('displayName' in snapshot.changelogs['100'][0], false);
  assert.deepEqual(snapshot.recentClosedSprints.map((sprint) => sprint.id), ['41', '42']);
  assert.ok(calls.some((call) => call[0] === 'search' && call[2] === 'page-2'));
});

test('bulkfetch HTTP 404 falls back to per-issue changelogs', async () => {
  const jira = minimalJira();
  jira.bulkChangelogs = async () => ({ ok: false, status: 404 });
  jira.getIssueChangelog = async () => ({
    isLast: true,
    values: [{
      id: '1',
      created: '2026-10-02T00:00:00.000Z',
      items: [
        { field: 'Sprint', fieldId: 'customfield_10020', fromString: '', toString: 'Sprint 42' },
        { field: 'description', fieldId: 'description', fromString: 'secret', toString: 'also secret' },
      ],
    }],
  });
  const snapshot = await collectSprintSnapshot({ sprintId: '42', jira, collectedAt: '2026-10-14T18:00:00.000Z' });
  assert.equal(snapshot.changelogs['100'].length, 1);
  assert.equal(snapshot.changelogs['100'][0].items.length, 1);
  assert.match(snapshot.warnings.join(' '), /bulkfetch returned HTTP 404/);
  assert.equal(JSON.stringify(snapshot.changelogs).includes('secret'), false);
});

test('manifest is Phase 1 only, with a placeholder app id', () => {
  const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
  assert.match(manifest, /ari:cloud:ecosystem::app\/00000000-0000-4000-8000-000000000000/);
  assert.match(manifest, /not a registered Forge app/);
  assert.match(manifest, /avi:jira-software:closed:sprint/);
  assert.match(manifest, /ignoreSelf: true/);
  assert.match(manifest, /queue: review-queue/);
  assert.match(manifest, /jira:projectPage:/);
  assert.match(manifest, /jira:projectSettingsPage:/);
  assert.match(manifest, /render: native/);
  assert.match(manifest, /nodejs24\.x/);
  assert.equal(manifest.includes('read:confluence'), false);
  assert.equal(manifest.includes('write:confluence'), false);
  for (const scope of ['read:jira-work', 'read:sprint:jira-software', 'storage:app']) {
    assert.match(manifest, new RegExp(scope));
  }
});

function minimalJira() {
  return {
    async getSprint() {
      return {
        id: 42,
        name: 'Sprint 42',
        state: 'closed',
        originBoardId: 7,
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-10-14T00:00:00.000Z',
        completeDate: '2026-10-14T12:00:00.000Z',
      };
    },
    async getClosedSprints() {
      return { startAt: 0, isLast: true, values: [] };
    },
    async getFields() {
      return [
        { id: 'customfield_10020', name: 'Sprint', clauseNames: ['sprint'] },
        { id: 'customfield_10021', name: 'Flagged', clauseNames: ['flagged'] },
      ];
    },
    async getStatuses() {
      return [{ name: 'Done' }];
    },
    async searchJql(body) {
      if (String(body.jql).includes('WAS IN')) {
        return { isLast: true, issues: [{ id: '100', key: 'PROJ-1' }] };
      }
      return {
        isLast: true,
        issues: [{
          id: '100',
          key: 'PROJ-1',
          fields: {
            summary: 'Item',
            status: { name: 'Done', statusCategory: { key: 'done', name: 'Done' } },
            issuetype: { name: 'Story' },
            project: { key: 'PROJ', id: '10' },
          },
        }],
      };
    },
  };
}
