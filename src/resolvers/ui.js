import Resolver from '@forge/resolver';
import { latestClosedSprint, pickFields } from '../collect/fields.js';
import { quoteJql } from '../collect/jql.js';
import { createUserJira } from '../collect/jira.js';
import { nextSearchToken } from '../collect/pagination.js';
import { enqueueSprintJob } from '../jobs/enqueue.js';
import { listProjectJobs } from '../storage/snapshots.js';

const resolver = new Resolver();

resolver.define('getProjectStatus', async ({ context }) => {
  const projectKey = readProjectKey(context);
  if (!projectKey) {
    return {
      projectKey: '',
      jobs: [],
      error: 'This Jira page did not include a project key.',
    };
  }
  const jobs = await listProjectJobs(projectKey);
  return { projectKey, jobs, error: '' };
});

resolver.define('generateLastClosedSprint', async ({ context }) => {
  const projectKey = readProjectKey(context);
  if (!projectKey) {
    return { ok: false, error: 'This Jira page did not include a project key.' };
  }

  const jira = createUserJira();
  const fields = pickFields(await jira.getFields());
  if (!fields.sprintFieldId) {
    return { ok: false, error: 'Jira did not return a Sprint field, so the last closed sprint could not be found.' };
  }

  const jql = `project = ${quoteJql(projectKey)} AND sprint in closedSprints() ORDER BY updated DESC`;
  const issues = [];
  let token;
  for (let page = 0; page < 5; page += 1) {
    const body = await jira.searchJql({
      jql,
      fields: [fields.sprintFieldId],
      maxResults: 50,
      ...(token ? { nextPageToken: token } : {}),
    });
    issues.push(...(body?.issues || []));
    const sprint = latestClosedSprint(issues, fields.sprintFieldId);
    if (sprint) {
      const result = await enqueueSprintJob({
        sprintId: sprint.id,
        source: 'settings',
        force: true,
        sprint: { name: sprint.name, originBoardId: sprint.boardId },
      });
      return {
        ok: true,
        jobId: result.jobId,
        sprintId: sprint.id,
        sprintName: sprint.name,
        enqueued: result.enqueued,
      };
    }
    const next = nextSearchToken(body);
    if (!next) {
      break;
    }
    token = next;
  }

  return { ok: false, error: `No closed sprint was found for project ${projectKey}.` };
});

export const handler = resolver.getDefinitions();

function readProjectKey(context) {
  const project = context?.extension?.project;
  if (project && typeof project.key === 'string' && project.key.trim()) {
    return project.key.trim();
  }
  return '';
}
