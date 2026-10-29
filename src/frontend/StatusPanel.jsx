import React from 'react';
import { Button, DynamicTable, Heading, Lozenge, LoadingButton, SectionMessage, Stack, Text } from '@forge/react';

const STATUS_APPEARANCE = {
  queued: 'information',
  collecting: 'inprogress',
  collected: 'success',
  failed: 'removed',
};

export function StatusPanel({
  title,
  description,
  projectKey,
  jobs,
  loading,
  error,
  onRefresh,
  onGenerate,
  generating,
  notice,
}) {
  const rows = (jobs || []).map((job) => ({
    key: job.jobId || job.sprintId,
    cells: [
      { key: 'sprint', content: job.sprintName || `Sprint ${job.sprintId}` },
      { key: 'status', content: <Lozenge appearance={STATUS_APPEARANCE[job.status] || 'default'}>{job.status || 'unknown'}</Lozenge> },
      { key: 'issues', content: String(job.issueCount || 0) },
      { key: 'committed', content: String(job.committedCount || 0) },
      { key: 'warnings', content: String(job.warningCount || 0) },
      { key: 'updated', content: job.collectedAt || job.updatedAt || '' },
    ],
  }));

  return (
    <Stack space="space.200">
      <Heading size="medium">{title}</Heading>
      <Text>{description}</Text>
      <Text>{projectKey ? `Project ${projectKey}` : 'Open this page from a Jira project.'}</Text>
      {error ? (
        <SectionMessage appearance="error" title="Something went wrong">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
      {notice ? (
        <SectionMessage appearance="information" title="Collection queued">
          <Text>{notice}</Text>
        </SectionMessage>
      ) : null}
      <Stack space="space.100">
        {onGenerate ? (
          <LoadingButton appearance="primary" isLoading={generating} onClick={onGenerate}>
            Generate for last closed sprint
          </LoadingButton>
        ) : null}
        <Button appearance="subtle" onClick={onRefresh}>Refresh status</Button>
      </Stack>
      <DynamicTable
        isLoading={loading}
        head={{
          cells: [
            { key: 'sprint', content: 'Sprint' },
            { key: 'status', content: 'Status' },
            { key: 'issues', content: 'Issues' },
            { key: 'committed', content: 'Committed' },
            { key: 'warnings', content: 'Warnings' },
            { key: 'updated', content: 'Updated' },
          ],
        }}
        rows={rows}
        emptyView="No sprint snapshots for this project yet. Close a sprint, or generate one from project settings."
      />
      {(jobs || []).some((job) => job.error) ? (
        <SectionMessage appearance="warning" title="Latest error">
          <Text>{(jobs || []).find((job) => job.error)?.error || ''}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
}
