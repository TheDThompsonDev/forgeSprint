import React, { useEffect, useState } from 'react';
import ForgeReconciler, { useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';
import { StatusPanel } from './StatusPanel.jsx';

const SettingsPage = () => {
  const context = useProductContext();
  const [status, setStatus] = useState({ loading: true, jobs: [], error: '', projectKey: '' });
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');

  const load = () => {
    setStatus((current) => ({ ...current, loading: true, error: '' }));
    invoke('getProjectStatus')
      .then((result) => {
        setStatus({
          loading: false,
          jobs: result?.jobs || [],
          error: result?.error || '',
          projectKey: result?.projectKey || '',
        });
      })
      .catch(() => {
        setStatus({ loading: false, jobs: [], error: 'Could not load sprint status.', projectKey: '' });
      });
  };

  const ready = Boolean(context);
  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    load();
    return undefined;
  }, [ready]);

  const onGenerate = () => {
    setGenerating(true);
    setNotice('');
    invoke('generateLastClosedSprint')
      .then((result) => {
        if (!result?.ok) {
          setStatus((current) => ({ ...current, error: result?.error || 'Could not queue a sprint.' }));
          return;
        }
        setNotice(`Queued ${result.sprintName || `sprint ${result.sprintId}`} (${result.jobId}). Refresh in a minute to see the snapshot status.`);
        load();
      })
      .catch(() => {
        setStatus((current) => ({ ...current, error: 'Could not queue the last closed sprint.' }));
      })
      .finally(() => setGenerating(false));
  };

  return (
    <StatusPanel
      title="Sprint review settings"
      description="Done statuses, story points, Confluence, and Google Slides are configured in later versions. This page can queue a snapshot for the last closed sprint so you can test without closing a sprint."
      projectKey={status.projectKey}
      jobs={status.jobs}
      loading={status.loading || !context}
      error={status.error}
      notice={notice}
      onRefresh={load}
      onGenerate={onGenerate}
      generating={generating}
    />
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <SettingsPage />
  </React.StrictMode>,
);
