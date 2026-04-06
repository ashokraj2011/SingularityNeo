import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchCapabilityEvalRun,
  listCapabilityEvalRuns,
  listCapabilityEvalSuites,
  runCapabilityEvalSuite,
} from '../lib/api';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { formatEnumLabel, getStatusTone } from '../lib/enterprise';
import type { EvalRun, EvalRunDetail, EvalSuite } from '../types';

const formatTimestamp = (value?: string) => {
  if (!value) {
    return 'Not yet';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const EvalCenter = () => {
  const { activeCapability } = useCapability();
  const { success } = useToast();
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRunDetail, setSelectedRunDetail] = useState<EvalRunDetail | null>(null);
  const [error, setError] = useState('');
  const [busySuiteId, setBusySuiteId] = useState<string | null>(null);

  const load = async () => {
    try {
      const [nextSuites, nextRuns] = await Promise.all([
        listCapabilityEvalSuites(activeCapability.id),
        listCapabilityEvalRuns(activeCapability.id),
      ]);
      setSuites(nextSuites);
      setRuns(nextRuns);
      setSelectedRunId(current => current || nextRuns[0]?.id || '');
      setError('');
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to load evaluation center data.',
      );
    }
  };

  useEffect(() => {
    void load();
  }, [activeCapability.id]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRunDetail(null);
      return;
    }

    void fetchCapabilityEvalRun(activeCapability.id, selectedRunId)
      .then(setSelectedRunDetail)
      .catch(nextError =>
        setError(
          nextError instanceof Error
            ? nextError.message
            : 'Unable to load eval run detail.',
        ),
      );
  }, [activeCapability.id, selectedRunId]);

  const handleRunSuite = async (suiteId: string) => {
    setBusySuiteId(suiteId);
    try {
      const detail = await runCapabilityEvalSuite(activeCapability.id, suiteId);
      setSelectedRunDetail(detail);
      setSelectedRunId(detail.run.id);
      await load();
      success(
        'Evaluation completed',
        `${detail.suite.name} finished with a score of ${detail.run.score?.toFixed(1) || '0.0'}%.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to run evaluation suite.',
      );
    } finally {
      setBusySuiteId(null);
    }
  };

  const stats = useMemo(() => {
    const completedRuns = runs.filter(run => run.status === 'COMPLETED');
    const averageScore =
      completedRuns.reduce((sum, run) => sum + (run.score || 0), 0) /
      Math.max(completedRuns.length, 1);

    return {
      suiteCount: suites.length,
      runCount: runs.length,
      completedCount: completedRuns.length,
      averageScore: Number.isFinite(averageScore) ? averageScore : 0,
    };
  }, [runs, suites]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Quality"
        context={activeCapability.id}
        title={`${activeCapability.name} Eval Center`}
        description="Run deterministic and retrieval-focused evaluation suites for the built-in agents, then review scored outcomes and judge-model summaries."
        actions={
          <button
            type="button"
            className="enterprise-button enterprise-button-secondary"
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Suites" value={stats.suiteCount} helper="Capability-scoped benchmark suites" icon={BarChart3} tone="brand" />
        <StatTile label="Runs" value={stats.runCount} helper={`${stats.completedCount} completed`} icon={ShieldCheck} tone="info" />
        <StatTile label="Average Score" value={`${stats.averageScore.toFixed(1)}%`} helper="Across completed eval runs" icon={CheckCircle2} tone="success" />
        <StatTile label="Judge Model" value={selectedRunDetail?.run.judgeModel || 'Pending'} helper="Summary model for selected run" icon={BrainCircuit} tone="neutral" />
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.9fr)]">
        <SectionCard
          title="Eval Suites"
          description="Seeded benchmark suites for workflow safety, retrieval quality, and built-in agent structure."
          icon={BarChart3}
        >
          {suites.length === 0 ? (
            <EmptyState
              title="No eval suites"
              description="The backend will seed eval suites for this capability the first time it loads."
              icon={BarChart3}
            />
          ) : (
            <div className="space-y-3">
              {suites.map(suite => (
                <div key={suite.id} className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-on-surface">{suite.name}</p>
                        <StatusBadge tone={suite.enabled ? 'success' : 'warning'}>
                          {suite.enabled ? 'Enabled' : 'Disabled'}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-sm text-secondary">{suite.description}</p>
                      <p className="mt-2 text-xs text-secondary">
                        {suite.agentRole} • {formatEnumLabel(suite.evalType)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="enterprise-button enterprise-button-primary"
                      onClick={() => void handleRunSuite(suite.id)}
                      disabled={busySuiteId === suite.id}
                    >
                      <Play size={16} />
                      {busySuiteId === suite.id ? 'Running...' : 'Run Suite'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Selected Eval Run"
          description="Detailed case-level scoring and judge summary for the chosen run."
          icon={ShieldCheck}
        >
          {selectedRunDetail ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={getStatusTone(selectedRunDetail.run.status)}>
                    {formatEnumLabel(selectedRunDetail.run.status)}
                  </StatusBadge>
                  <StatusBadge tone="brand">
                    {selectedRunDetail.run.score?.toFixed(1) || '0.0'}%
                  </StatusBadge>
                </div>
                <h2 className="text-lg font-bold text-on-surface">
                  {selectedRunDetail.suite.name}
                </h2>
                <p className="text-sm text-secondary">
                  {selectedRunDetail.run.summary || 'No summary yet.'}
                </p>
              </div>

              <div className="space-y-3">
                {selectedRunDetail.results.map(result => {
                  const evalCase = selectedRunDetail.cases.find(item => item.id === result.evalCaseId);
                  return (
                    <div key={result.id} className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-on-surface">
                          {evalCase?.name || result.evalCaseId}
                        </p>
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={getStatusTone(result.status)}>{result.status}</StatusBadge>
                          <span className="text-xs font-bold text-secondary">{result.score.toFixed(1)}%</span>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-secondary">{result.summary}</p>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-outline-variant/35 px-4 py-4">
                <p className="form-kicker">Run Metadata</p>
                <div className="mt-3 grid gap-3 text-sm text-secondary">
                  <span>Created: {formatTimestamp(selectedRunDetail.run.createdAt)}</span>
                  <span>Completed: {formatTimestamp(selectedRunDetail.run.completedAt)}</span>
                  <span>Judge: {selectedRunDetail.run.judgeModel || 'Default model fallback'}</span>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Select or run a suite"
              description="Choose an existing eval run or start a suite to review its results here."
              icon={ShieldCheck}
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
};

export default EvalCenter;
