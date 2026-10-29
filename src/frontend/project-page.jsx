import React, { useEffect, useState } from 'react';
import ForgeReconciler, { useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';
import { StatusPanel } from './StatusPanel.jsx';

const ProjectPage = () => {
  const context = useProductContext();
  const status = useStatus(context);

  return (
    <StatusPanel
      title="Sprint reviews"
      description="Closing a sprint collects the sprint snapshot. The leadership narrative, Confluence page, and slide deck are not part of this version yet."
      projectKey={status.projectKey}
      jobs={status.jobs}
      loading={status.loading}
      error={status.error}
      onRefresh={status.refresh}
    />
  );
};

function useStatus(context) {
  const [state, setState] = useState({ loading: true, jobs: [], error: '', projectKey: '' });

  const load = () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    invoke('getProjectStatus')
      .then((result) => {
        setState({
          loading: false,
          jobs: result?.jobs || [],
          error: result?.error || '',
          projectKey: result?.projectKey || '',
        });
      })
      .catch(() => {
        setState({ loading: false, jobs: [], error: 'Could not load sprint status.', projectKey: '' });
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

  return { ...state, refresh: load };
}

ForgeReconciler.render(
  <React.StrictMode>
    <ProjectPage />
  </React.StrictMode>,
);
