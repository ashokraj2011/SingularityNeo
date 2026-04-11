import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  Filter,
  FolderArchive,
  GitMerge,
  MessageSquareQuote,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ArtifactPreview from '../components/ArtifactPreview';
import { useCapability } from '../context/CapabilityContext';
import { EnterpriseTone, getStatusTone } from '../lib/enterprise';
import { compactMarkdownPreview } from '../lib/markdown';
import {
  fetchArtifactContent,
  fetchCapabilityFlightRecorder,
  fetchCompletedWorkOrders,
  fetchLedgerArtifacts,
  fetchWorkItemEvidence,
  getArtifactDownloadUrl,
  getCapabilityFlightRecorderDownloadUrl,
  getWorkItemFlightRecorderDownloadUrl,
  getWorkItemEvidenceBundleDownloadUrl,
} from '../lib/api';
import { cn } from '../lib/utils';
import { getBusinessEvidenceLabel } from '../lib/capabilityExperience';
import {
  findNearestRecorderEvent,
  formatElapsedTime,
  normalizeFlightRecorderTimeline,
  type RecorderEventCategory,
} from '../lib/flightRecorderTimeline';
import type {
  ArtifactContentResponse,
  ArtifactKind,
  CapabilityFlightRecorderSnapshot,
  CompletedWorkOrderDetail,
  CompletedWorkOrderSummary,
  FlightRecorderVerdict,
  HumanInteractionRecord,
  LedgerArtifactRecord,
  WorkItemFlightRecorderDetail,
  WorkItemPhase,
} from '../types';
import {
  EmptyState,
  FilterBar,
  PageHeader,
  StatTile,
  StatusBadge,
  Toolbar,
} from '../components/EnterpriseUI';
import { AdvancedDisclosure } from '../components/WorkspaceUI';

type LedgerTab = 'artifacts' | 'completed' | 'interactions' | 'logs' | 'flight-recorder';

const LEDGER_PRIMARY_TABS: Array<{
  id: LedgerTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: 'artifacts', label: 'Artifacts', icon: FolderArchive },
  { id: 'completed', label: 'Completed Work', icon: CheckCircle2 },
  { id: 'flight-recorder', label: 'Flight Recorder', icon: FileSearch },
];

const LEDGER_ADVANCED_TABS: Array<{
  id: LedgerTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: 'interactions', label: 'Human Interactions', icon: MessageSquareQuote },
  { id: 'logs', label: 'Logs & Events', icon: TerminalSquare },
];

const HUMAN_INTERACTION_KINDS = new Set<ArtifactKind>([
  'APPROVAL_RECORD',
  'INPUT_NOTE',
  'CONFLICT_RESOLUTION',
]);

const formatTimestamp = (value?: string) => {
  if (!value) {
    return 'Not available';
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

const formatPhase = (phase?: WorkItemPhase) =>
  phase
    ? phase
        .toLowerCase()
        .split('_')
        .map(token => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ')
    : 'Unscoped';

const summarizeKind = (kind?: ArtifactKind) => getBusinessEvidenceLabel(kind);

const getVerdictTone = (verdict?: FlightRecorderVerdict): EnterpriseTone => {
  if (verdict === 'ALLOWED') {
    return 'success';
  }
  if (verdict === 'NEEDS_APPROVAL') {
    return 'warning';
  }
  if (verdict === 'DENIED') {
    return 'danger';
  }
  return 'neutral';
};

const RECORDER_CATEGORY_LABELS: Record<RecorderEventCategory, string> = {
  run: 'Runs',
  step: 'Steps',
  gate: 'Gates',
  policy: 'Policies',
  tool: 'Tools',
  artifact: 'Evidence',
  handoff: 'Handoffs',
  verdict: 'Verdict',
};

const RECORDER_CATEGORY_TONES: Record<RecorderEventCategory, EnterpriseTone> = {
  run: 'brand',
  step: 'info',
  gate: 'warning',
  policy: 'warning',
  tool: 'info',
  artifact: 'success',
  handoff: 'brand',
  verdict: 'success',
};

const getRecorderCategoryTone = (category: RecorderEventCategory) =>
  RECORDER_CATEGORY_TONES[category];

const formatTimelineDate = (value?: string) =>
  value ? formatTimestamp(value) : 'Time not recorded';

const PreviewPane = ({
  content,
}: {
  content?: ArtifactContentResponse;
}) => {
  if (!content) {
    return (
      <div className="rounded-3xl border border-outline-variant/15 bg-surface-container-low px-5 py-12 text-center text-sm text-secondary">
        Select an artifact to preview its evidence payload.
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-outline-variant/15 bg-surface-container-low">
      <div className="flex items-center justify-between border-b border-outline-variant/10 px-5 py-4">
        <div>
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
            Artifact Preview
          </p>
          <p className="mt-1 text-sm font-bold text-on-surface">{content.fileName}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-primary">
          {content.contentFormat}
        </span>
      </div>
      <div className="px-5 py-5">
        <ArtifactPreview
          format={content.contentFormat}
          content={
            content.contentFormat === 'JSON'
              ? JSON.stringify(content.contentJson || {}, null, 2)
              : content.contentText || ''
          }
          emptyLabel="No preview is available for this artifact."
        />
      </div>
    </div>
  );
};

const InteractionTimeline = ({
  items,
}: {
  items: HumanInteractionRecord[];
}) => {
  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-outline-variant/15 bg-surface-container-low px-5 py-10 text-center text-sm text-secondary">
        No approvals or human-input records have been captured for this selection yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map(item => (
        <div
          key={item.id}
          className="rounded-3xl border border-outline-variant/15 bg-surface-container-low px-5 py-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-on-surface">
                {item.stepName || summarizeKind(
                  item.interactionType === 'APPROVAL'
                    ? 'APPROVAL_RECORD'
                    : item.interactionType === 'CONFLICT_RESOLUTION'
                    ? 'CONFLICT_RESOLUTION'
                    : 'INPUT_NOTE',
                )}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">{item.message}</p>
            </div>
            <span
              className={cn(
                'rounded-full px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.14em]',
                item.status === 'RESOLVED'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700',
              )}
            >
              {item.status}
            </span>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-secondary md:grid-cols-2">
            <span>
              Requested by <strong>{item.requestedByName || item.requestedBy}</strong>
            </span>
            <span>Requested {formatTimestamp(item.createdAt)}</span>
            {item.resolvedBy && (
              <span>
                Resolved by <strong>{item.resolvedByName || item.resolvedBy}</strong>
              </span>
            )}
            {item.resolvedAt && <span>Resolved {formatTimestamp(item.resolvedAt)}</span>}
          </div>
          {item.resolution && (
            <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm leading-relaxed text-secondary">
              {item.resolution}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const Ledger = () => {
  const navigate = useNavigate();
  const { activeCapability } = useCapability();
  const [tab, setTab] = useState<LedgerTab>('artifacts');
  const [artifacts, setArtifacts] = useState<LedgerArtifactRecord[]>([]);
  const [completedOrders, setCompletedOrders] = useState<CompletedWorkOrderSummary[]>([]);
  const [flightRecorder, setFlightRecorder] =
    useState<CapabilityFlightRecorderSnapshot | null>(null);
  const [evidenceByWorkItemId, setEvidenceByWorkItemId] = useState<
    Record<string, CompletedWorkOrderDetail>
  >({});
  const [artifactContentById, setArtifactContentById] = useState<
    Record<string, ArtifactContentResponse>
  >({});
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>('');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [phaseFilter, setPhaseFilter] = useState<string>('ALL');
  const [kindFilter, setKindFilter] = useState<string>('ALL');
  const [agentFilter, setAgentFilter] = useState<string>('ALL');
  const [attemptFilter, setAttemptFilter] = useState<string>('ALL');
  const [recorderSearchQuery, setRecorderSearchQuery] = useState('');
  const [recorderCategoryFilter, setRecorderCategoryFilter] = useState<
    'ALL' | RecorderEventCategory
  >('ALL');
  const [selectedRecorderEventId, setSelectedRecorderEventId] = useState('');
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [isPlaybackRunning, setIsPlaybackRunning] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const autoPlayedWorkItemsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    let isMounted = true;

    setIsLoading(true);
    setError('');
    setEvidenceByWorkItemId({});
    setArtifactContentById({});
    setFlightRecorder(null);

    Promise.all([
      fetchLedgerArtifacts(activeCapability.id),
      fetchCompletedWorkOrders(activeCapability.id),
      fetchCapabilityFlightRecorder(activeCapability.id),
    ])
      .then(([artifactRecords, summaries, recorderSnapshot]) => {
        if (!isMounted) {
          return;
        }

        setArtifacts(artifactRecords);
        setCompletedOrders(summaries);
        setFlightRecorder(recorderSnapshot);
        setSelectedArtifactId(artifactRecords[0]?.artifact.id || '');
        setSelectedWorkItemId(
          summaries[0]?.workItem.id ||
            recorderSnapshot.workItems[0]?.workItem.id ||
            '',
        );
      })
      .catch(nextError => {
        if (!isMounted) {
          return;
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : 'Ledger evidence could not be loaded.',
        );
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeCapability.id]);

  useEffect(() => {
    if (!selectedWorkItemId || evidenceByWorkItemId[selectedWorkItemId]) {
      return;
    }

    let isMounted = true;
    setIsDetailLoading(true);
    fetchWorkItemEvidence(activeCapability.id, selectedWorkItemId)
      .then(detail => {
        if (!isMounted) {
          return;
        }
        setEvidenceByWorkItemId(previous => ({
          ...previous,
          [selectedWorkItemId]: detail,
        }));
      })
      .catch(nextError => {
        if (!isMounted) {
          return;
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : 'Work-order evidence could not be loaded.',
        );
      })
      .finally(() => {
        if (isMounted) {
          setIsDetailLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeCapability.id, evidenceByWorkItemId, selectedWorkItemId]);

  const artifactPhaseOptions = useMemo(
    () =>
      Array.from(
        new Set(artifacts.map(record => record.artifact.phase).filter(Boolean) as string[]),
      ),
    [artifacts],
  );
  const artifactKindOptions = useMemo(
    () =>
      Array.from(
        new Set(
          artifacts
            .map(record => record.artifact.artifactKind)
            .filter(Boolean) as ArtifactKind[],
        ),
      ),
    [artifacts],
  );
  const artifactAgentOptions = useMemo(
    () =>
      Array.from(
        new Set(
          artifacts
            .map(
              record =>
                record.sourceAgentName ||
                record.artifact.connectedAgentId ||
                record.artifact.agent,
            )
            .filter(Boolean) as string[],
        ),
      ),
    [artifacts],
  );
  const artifactAttemptOptions = useMemo(
    () =>
      Array.from(
        new Set(artifacts.map(record => record.runAttempt).filter(Boolean) as number[]),
      ).sort((left, right) => right - left),
    [artifacts],
  );

  const interactionArtifacts = useMemo(
    () =>
      artifacts.filter(record =>
        HUMAN_INTERACTION_KINDS.has(record.artifact.artifactKind || 'EXECUTION_SUMMARY'),
      ),
    [artifacts],
  );

  const filteredArtifacts = useMemo(() => {
    const source = tab === 'interactions' ? interactionArtifacts : artifacts;
    return source.filter(record => {
      const query = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !query ||
        record.artifact.name.toLowerCase().includes(query) ||
        (record.workItemTitle || '').toLowerCase().includes(query) ||
        (record.artifact.summary || '').toLowerCase().includes(query);
      const matchesPhase =
        phaseFilter === 'ALL' || record.artifact.phase === phaseFilter;
      const matchesKind =
        kindFilter === 'ALL' || record.artifact.artifactKind === kindFilter;
      const matchesAgent =
        agentFilter === 'ALL' ||
        record.sourceAgentName === agentFilter ||
        record.artifact.connectedAgentId === agentFilter ||
        record.artifact.agent === agentFilter;
      const matchesAttempt =
        attemptFilter === 'ALL' ||
        String(record.runAttempt || '') === String(attemptFilter);

      return matchesQuery && matchesPhase && matchesKind && matchesAgent && matchesAttempt;
    });
  }, [
    agentFilter,
    artifacts,
    attemptFilter,
    interactionArtifacts,
    kindFilter,
    phaseFilter,
    searchQuery,
    tab,
  ]);

  useEffect(() => {
    if (tab !== 'artifacts' && tab !== 'interactions') {
      return;
    }

    if (filteredArtifacts.some(record => record.artifact.id === selectedArtifactId)) {
      return;
    }

    setSelectedArtifactId(filteredArtifacts[0]?.artifact.id || '');
  }, [filteredArtifacts, selectedArtifactId, tab]);

  useEffect(() => {
    const selectedArtifact = filteredArtifacts.find(
      record => record.artifact.id === selectedArtifactId,
    );
    if (!selectedArtifact) {
      return;
    }

    if (artifactContentById[selectedArtifact.artifact.id]) {
      return;
    }

    let isMounted = true;
    fetchArtifactContent(activeCapability.id, selectedArtifact.artifact.id)
      .then(content => {
        if (!isMounted) {
          return;
        }
        setArtifactContentById(previous => ({
          ...previous,
          [selectedArtifact.artifact.id]: content,
        }));
      })
      .catch(nextError => {
        if (!isMounted) {
          return;
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : 'Artifact preview could not be loaded.',
        );
      });

    return () => {
      isMounted = false;
    };
  }, [activeCapability.id, artifactContentById, filteredArtifacts, selectedArtifactId]);

  const selectedArtifact = filteredArtifacts.find(
    record => record.artifact.id === selectedArtifactId,
  );
  const selectedArtifactContent = selectedArtifact
    ? artifactContentById[selectedArtifact.artifact.id]
    : undefined;
  const selectedEvidence = selectedWorkItemId
    ? evidenceByWorkItemId[selectedWorkItemId]
    : undefined;

  const stats = useMemo(
    () => ({
      artifacts: artifacts.length,
      completed: completedOrders.length,
      handoffs: artifacts.filter(
        record => record.artifact.artifactKind === 'HANDOFF_PACKET',
      ).length,
      interactions: interactionArtifacts.length,
    }),
    [artifacts, completedOrders.length, interactionArtifacts.length],
  );

  const recorderWorkItemOptions = useMemo(
    () => flightRecorder?.workItems || [],
    [flightRecorder],
  );
  const filteredRecorderWorkItems = useMemo(() => {
    const query = recorderSearchQuery.trim().toLowerCase();
    return recorderWorkItemOptions.filter(record =>
      !query ||
      record.workItem.title.toLowerCase().includes(query) ||
      record.workItem.id.toLowerCase().includes(query) ||
      record.verdict.toLowerCase().includes(query),
    );
  }, [recorderSearchQuery, recorderWorkItemOptions]);
  const selectedRecorderDetail = useMemo<WorkItemFlightRecorderDetail | null>(
    () =>
      (selectedWorkItemId
        ? flightRecorder?.workItems.find(
            workItem => workItem.workItem.id === selectedWorkItemId,
          )
        : flightRecorder?.workItems[0]) || null,
    [flightRecorder, selectedWorkItemId],
  );
  const recorderTimeline = useMemo(
    () => normalizeFlightRecorderTimeline(selectedRecorderDetail),
    [selectedRecorderDetail],
  );
  const visibleRecorderEvents = useMemo(
    () =>
      recorderTimeline.events.filter(
        event =>
          recorderCategoryFilter === 'ALL' ||
          event.category === recorderCategoryFilter,
      ),
    [recorderCategoryFilter, recorderTimeline.events],
  );
  const selectedTimelineEvent = useMemo(
    () =>
      recorderTimeline.events.find(event => event.id === selectedRecorderEventId) ||
      findNearestRecorderEvent(recorderTimeline.events, playbackPosition),
    [playbackPosition, recorderTimeline.events, selectedRecorderEventId],
  );

  useEffect(() => {
    const workItemId = selectedRecorderDetail?.workItem.id;
    const firstEvent = recorderTimeline.events[0];

    setRecorderCategoryFilter('ALL');
    setSelectedRecorderEventId(firstEvent?.id || '');
    setPlaybackPosition(firstEvent?.trackPositionPercent || 0);

    if (
      workItemId &&
      recorderTimeline.events.length > 1 &&
      !prefersReducedMotion &&
      !autoPlayedWorkItemsRef.current.has(workItemId)
    ) {
      autoPlayedWorkItemsRef.current.add(workItemId);
      setIsPlaybackRunning(true);
    } else {
      setIsPlaybackRunning(false);
    }
  }, [
    prefersReducedMotion,
    recorderTimeline.events,
    selectedRecorderDetail?.workItem.id,
  ]);

  useEffect(() => {
    if (!isPlaybackRunning || prefersReducedMotion || recorderTimeline.events.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setPlaybackPosition(current => {
        const next = Math.min(100, current + 1.4);
        if (next >= 100) {
          setIsPlaybackRunning(false);
        }
        return next;
      });
    }, 120);

    return () => window.clearInterval(interval);
  }, [isPlaybackRunning, prefersReducedMotion, recorderTimeline.events.length]);

  useEffect(() => {
    const nearest = findNearestRecorderEvent(recorderTimeline.events, playbackPosition);
    if (nearest && nearest.id !== selectedRecorderEventId) {
      setSelectedRecorderEventId(nearest.id);
    }
  }, [playbackPosition, recorderTimeline.events, selectedRecorderEventId]);

  const renderArtifactList = () => (
    <div className="space-y-3">
      {filteredArtifacts.map(record => {
        const isSelected = record.artifact.id === selectedArtifactId;
        return (
          <button
            key={record.artifact.id}
            type="button"
            onClick={() => setSelectedArtifactId(record.artifact.id)}
            className={cn(
              'w-full rounded-2xl border px-4 py-4 text-left transition-all',
              isSelected
                ? 'border-primary/30 bg-primary/5 shadow-[0_8px_24px_rgba(0,132,61,0.08)]'
                : 'border-outline-variant/50 bg-white hover:bg-surface-container-low',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-on-surface">{record.artifact.name}</p>
                <p className="mt-1 text-xs text-secondary">
                  {record.workItemTitle || record.artifact.workItemId || 'Unlinked work item'}
                </p>
              </div>
              <StatusBadge tone={getStatusTone(record.artifact.artifactKind)}>
                {summarizeKind(record.artifact.artifactKind)}
              </StatusBadge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[0.6875rem] text-secondary">
              <span>{formatPhase(record.artifact.phase)}</span>
              {record.runAttempt && <span>Attempt {record.runAttempt}</span>}
              {record.sourceAgentName && <span>{record.sourceAgentName}</span>}
            </div>
            {(record.artifact.summary || record.artifact.description) && (
              <p className="mt-3 text-xs leading-relaxed text-secondary">
                {compactMarkdownPreview(
                  record.artifact.summary || record.artifact.description,
                  180,
                )}
              </p>
            )}
          </button>
        );
      })}

      {filteredArtifacts.length === 0 && (
        <EmptyState
          title="No artifacts match the current filters"
          description="Adjust the phase, kind, agent, or run attempt filters to reveal evidence records."
          icon={FolderArchive}
          className="min-h-[12rem]"
        />
      )}
    </div>
  );

  const renderCompletedOrderList = () => (
    <div className="space-y-3">
      {completedOrders.map(order => {
        const isSelected = order.workItem.id === selectedWorkItemId;
        return (
          <button
            key={order.workItem.id}
            type="button"
            onClick={() => setSelectedWorkItemId(order.workItem.id)}
            className={cn(
              'w-full rounded-2xl border px-4 py-4 text-left transition-all',
              isSelected
                ? 'border-primary/30 bg-primary/5 shadow-[0_8px_24px_rgba(0,132,61,0.08)]'
                : 'border-outline-variant/50 bg-white hover:bg-surface-container-low',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-on-surface">{order.workItem.title}</p>
                <p className="mt-1 text-xs text-secondary">
                  Completed {formatTimestamp(order.completedAt)}
                </p>
              </div>
              <StatusBadge tone="success">Done</StatusBadge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[0.6875rem] text-secondary">
              <span>{order.artifactCount} artifacts</span>
              <span>{order.handoffCount} handoffs</span>
              <span>{order.interactionCount} interactions</span>
              <span>{order.logCount} logs</span>
            </div>
          </button>
        );
      })}

      {completedOrders.length === 0 && (
        <EmptyState
          title="No completed work orders"
          description="Completed stories, evidence bundles, approvals, and phase outputs will appear here after execution finishes."
          icon={CheckCircle2}
          className="min-h-[12rem]"
        />
      )}
    </div>
  );

  const renderFlightRecorderWorkItemRail = () => (
    <div className="rounded-[2rem] border border-outline-variant/15 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <Radio size={18} />
          </div>
          <div>
            <p className="form-kicker">Work Item Signal</p>
            <h2 className="text-lg font-extrabold tracking-tight text-primary">
              Select a replay record
            </h2>
          </div>
        </div>
        <input
          value={recorderSearchQuery}
          onChange={event => setRecorderSearchQuery(event.target.value)}
          placeholder="Search work item or verdict"
          className="field-input lg:max-w-sm"
        />
      </div>

      <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
        {filteredRecorderWorkItems.map(record => {
          const timeline = normalizeFlightRecorderTimeline(record);
          const finalTimelineEvent = timeline.events[timeline.events.length - 1];
          const latestEvent = record.events[record.events.length - 1];
          const latestPhase = latestEvent?.phase || record.workItem.phase;
          const isSelected = record.workItem.id === selectedWorkItemId;

          return (
            <button
              key={record.workItem.id}
              type="button"
              onClick={() => setSelectedWorkItemId(record.workItem.id)}
              className={cn(
                'min-w-[17rem] max-w-[19rem] flex-1 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all',
                isSelected
                  ? 'border-primary/40 bg-primary/5 shadow-[0_14px_34px_rgba(0,132,61,0.12)]'
                  : 'border-outline-variant/50 bg-white hover:border-primary/20 hover:bg-surface-container-low',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-on-surface">
                    {record.workItem.title}
                  </p>
                  <p className="mt-1 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-outline">
                    {record.workItem.id}
                  </p>
                </div>
                <StatusBadge tone={getVerdictTone(record.verdict)}>
                  {record.verdict}
                </StatusBadge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[0.6875rem] font-semibold text-secondary">
                <span>{formatPhase(latestPhase)}</span>
                <span>{timeline.durationLabel}</span>
                <span>{record.humanGates.length} gates</span>
                <span>{record.artifacts.length + record.handoffArtifacts.length} evidence</span>
              </div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(8, finalTimelineEvent?.trackPositionPercent || 8),
                    )}%`,
                  }}
                />
              </div>
            </button>
          );
        })}

        {filteredRecorderWorkItems.length === 0 && (
          <div className="min-w-full">
            <EmptyState
              title="No work item flight records"
              description="Start workflow execution to generate a replayable audit trail."
              icon={Radio}
              className="min-h-[10rem]"
            />
          </div>
        )}
      </div>
    </div>
  );

  const renderControlTowerRecorder = () => {
    if (!flightRecorder) {
      return (
        <EmptyState
          title="Loading Flight Recorder"
          description="Assembling the capability audit feed from runs, waits, policies, tools, and evidence."
          icon={Clock3}
        />
      );
    }

    if (!selectedRecorderDetail) {
      return (
        <div className="rounded-3xl border border-outline-variant/15 bg-white px-6 py-16 text-center text-sm text-secondary shadow-sm">
          No work-item release record is selected yet.
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flight-recorder-tower">
          <div className="flight-recorder-radar-sweep" />
          <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={getVerdictTone(selectedRecorderDetail.verdict)}>
                  {selectedRecorderDetail.verdict}
                </StatusBadge>
                {selectedRecorderDetail.latestRun && (
                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-emerald-100">
                    Attempt {selectedRecorderDetail.latestRun.attemptNumber}
                  </span>
                )}
              </div>
              <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white">
                Control Tower Replay
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-emerald-50/75">
                {selectedRecorderDetail.workItem.title} moved through{' '}
                {recorderTimeline.events.length} audit checkpoints over{' '}
                {recorderTimeline.durationLabel}.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-right text-xs text-emerald-50/70">
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                <p className="font-bold uppercase tracking-[0.16em]">Elapsed</p>
                <p className="mt-2 text-xl font-extrabold text-white">
                  {formatElapsedTime(
                    selectedTimelineEvent?.elapsedMs || recorderTimeline.durationMs,
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
                <p className="font-bold uppercase tracking-[0.16em]">Checkpoints</p>
                <p className="mt-2 text-xl font-extrabold text-white">
                  {recorderTimeline.events.length}
                </p>
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPlaybackRunning(current => !current)}
              disabled={prefersReducedMotion || recorderTimeline.events.length <= 1}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isPlaybackRunning ? <Pause size={16} /> : <Play size={16} />}
              {isPlaybackRunning ? 'Pause replay' : 'Play replay'}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={playbackPosition}
              onChange={event => {
                setIsPlaybackRunning(false);
                setPlaybackPosition(Number(event.target.value));
              }}
              className="flight-recorder-scrubber min-w-[14rem] flex-1"
              aria-label="Scrub Flight Recorder timeline"
            />
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-emerald-50/75">
              {prefersReducedMotion ? 'Reduced motion' : 'Auto replay armed'}
            </span>
          </div>

          <div className="relative z-10 mt-5 flex flex-wrap gap-2">
            {(['ALL', ...recorderTimeline.categories] as Array<'ALL' | RecorderEventCategory>).map(
              category => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setRecorderCategoryFilter(category)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.14em] transition-all',
                    recorderCategoryFilter === category
                      ? 'border-emerald-300 bg-emerald-300 text-slate-950'
                      : 'border-white/10 bg-white/5 text-emerald-50/75 hover:bg-white/10',
                  )}
                >
                  {category === 'ALL' ? (
                    'All Signals'
                  ) : (
                    <>
                      <StatusBadge tone={getRecorderCategoryTone(category)}>
                        {RECORDER_CATEGORY_LABELS[category]}
                      </StatusBadge>
                    </>
                  )}
                </button>
              ),
            )}
          </div>

          <div className="flight-recorder-runway">
            <div className="flight-recorder-route" />
            <div
              className="flight-recorder-route-progress"
              style={{ width: `${playbackPosition}%` }}
            />
            {recorderTimeline.phaseStations.map(station => (
              <div
                key={station.phase}
                className="flight-recorder-phase-station"
                style={{ left: `${station.trackPositionPercent}%` }}
              >
                <span className="flight-recorder-phase-dot" />
                <span className="flight-recorder-phase-label">{station.label}</span>
                {station.eventCount > 0 && (
                  <span className="flight-recorder-phase-count">{station.eventCount}</span>
                )}
              </div>
            ))}
            {visibleRecorderEvents.map(signal => (
              <button
                key={signal.id}
                type="button"
                onClick={() => {
                  setIsPlaybackRunning(false);
                  setPlaybackPosition(signal.trackPositionPercent);
                  setSelectedRecorderEventId(signal.id);
                }}
                className={cn(
                  'flight-recorder-checkpoint',
                  `flight-recorder-checkpoint-${signal.category}`,
                  signal.id === selectedTimelineEvent?.id && 'flight-recorder-checkpoint-active',
                )}
                style={{
                  left: `${signal.trackPositionPercent}%`,
                  top: `${42 + signal.laneOffset * 13}%`,
                }}
                title={signal.event.title}
              >
                <span />
              </button>
            ))}
            <div
              className="flight-recorder-capsule"
              style={{ left: `${playbackPosition}%` }}
            >
              <Zap size={18} />
            </div>

            {recorderTimeline.events.length === 0 && (
              <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-3xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-sm text-emerald-50/70">
                No replay checkpoints are available for this work item yet.
              </div>
            )}
          </div>

          <div className="relative z-10 mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-5 text-white">
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-emerald-100/70">
                Active checkpoint
              </p>
              <h3 className="mt-3 text-xl font-extrabold">
                {selectedTimelineEvent?.event.title || 'Awaiting signal'}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-emerald-50/75">
                {selectedTimelineEvent?.event.description ||
                  'Move the scrubber or select a checkpoint to inspect the audit signal.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-emerald-50/70">
                <span>{selectedTimelineEvent?.elapsedLabel || '0s'}</span>
                <span>
                  {selectedTimelineEvent
                    ? RECORDER_CATEGORY_LABELS[selectedTimelineEvent.category]
                    : 'No category'}
                </span>
                <span>{selectedTimelineEvent?.event.actorName || selectedTimelineEvent?.event.actorId || 'System'}</span>
                <span>{formatTimelineDate(selectedTimelineEvent?.event.timestamp)}</span>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-slate-950/55 p-5 text-emerald-50">
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-emerald-100/70">
                Jump channels
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {(['gate', 'policy', 'handoff', 'verdict'] as RecorderEventCategory[]).map(
                  category => {
                    const target = recorderTimeline.events.find(
                      signal => signal.category === category,
                    );
                    return (
                      <button
                        key={category}
                        type="button"
                        disabled={!target}
                        onClick={() => {
                          if (!target) {
                            return;
                          }
                          setIsPlaybackRunning(false);
                          setRecorderCategoryFilter(category);
                          setSelectedRecorderEventId(target.id);
                          setPlaybackPosition(target.trackPositionPercent);
                        }}
                        className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.14em] text-emerald-50/80 transition-all hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        {RECORDER_CATEGORY_LABELS[category]}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderRecorderAuditSections = () => {
    if (!selectedRecorderDetail) {
      return null;
    }

    const combinedArtifacts = [
      ...selectedRecorderDetail.artifacts,
      ...selectedRecorderDetail.handoffArtifacts,
    ];

    return (
      <div className="space-y-6">
        <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="form-kicker">Audit drawer</p>
              <h3 className="mt-2 text-xl font-extrabold text-primary">
                {selectedRecorderDetail.workItem.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {selectedRecorderDetail.verdictReason}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={getWorkItemFlightRecorderDownloadUrl(
                  activeCapability.id,
                  selectedRecorderDetail.workItem.id,
                  'markdown',
                )}
                className="enterprise-button enterprise-button-secondary"
              >
                <Download size={16} />
                Markdown
              </a>
              <a
                href={getWorkItemFlightRecorderDownloadUrl(
                  activeCapability.id,
                  selectedRecorderDetail.workItem.id,
                  'json',
                )}
                className="enterprise-button enterprise-button-secondary"
              >
                <Download size={16} />
                JSON
              </a>
              <button
                type="button"
                onClick={() =>
                  navigate(
                    `/orchestrator?selected=${encodeURIComponent(
                      selectedRecorderDetail.workItem.id,
                    )}`,
                  )
                }
                className="enterprise-button enterprise-button-primary"
              >
                <ExternalLink size={16} />
                Open work
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              {
                label: 'Human gates',
                value: selectedRecorderDetail.humanGates.length,
                icon: ShieldCheck,
              },
              {
                label: 'Policies',
                value: selectedRecorderDetail.policyDecisions.length,
                icon: FileSearch,
              },
              {
                label: 'Evidence',
                value: selectedRecorderDetail.artifacts.length,
                icon: FileText,
              },
              {
                label: 'Handoffs',
                value: selectedRecorderDetail.handoffArtifacts.length,
                icon: GitMerge,
              },
              {
                label: 'Tools',
                value: selectedRecorderDetail.telemetry.toolInvocationCount,
                icon: TerminalSquare,
              },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-2xl bg-surface-container-low px-4 py-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                      {item.label}
                    </p>
                    <p className="mt-2 text-2xl font-extrabold text-primary">
                      {item.value}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-3 text-primary shadow-sm">
                    <item.icon size={16} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl bg-surface-container-low px-4 py-4">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
              Telemetry references
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-secondary">
              <span>{selectedRecorderDetail.telemetry.toolInvocationCount} tools</span>
              <span>{selectedRecorderDetail.telemetry.failedToolInvocationCount} failed</span>
              <span>{selectedRecorderDetail.telemetry.totalToolLatencyMs} ms</span>
              <span>${selectedRecorderDetail.telemetry.totalToolCostUsd.toFixed(4)}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/run-console')}
              className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary"
            >
              Open Run Console
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-primary" />
            <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
              Human approvals, input, and conflicts
            </h3>
          </div>
          <div className="mt-4 space-y-3">
            {selectedRecorderDetail.humanGates.map(gate => (
              <div
                key={gate.waitId}
                className="rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-on-surface">
                      {summarizeKind(
                        gate.type === 'APPROVAL'
                          ? 'APPROVAL_RECORD'
                          : gate.type === 'CONFLICT_RESOLUTION'
                          ? 'CONFLICT_RESOLUTION'
                          : 'INPUT_NOTE',
                      )}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      {gate.message}
                    </p>
                  </div>
                  <StatusBadge tone={gate.status === 'RESOLVED' ? 'success' : 'warning'}>
                    {gate.status}
                  </StatusBadge>
                </div>
                {gate.resolution && (
                  <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm leading-relaxed text-secondary">
                    {gate.resolution}
                  </div>
                )}
                {gate.contrarianReview && (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                    Contrarian review: {gate.contrarianReview.summary || gate.contrarianReview.status}
                  </div>
                )}
              </div>
            ))}
            {selectedRecorderDetail.humanGates.length === 0 && (
              <p className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-secondary">
                No human gate records are linked to this release record.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <FileSearch size={16} className="text-primary" />
              <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                Policy decisions
              </h3>
            </div>
            <div className="mt-4 space-y-3">
              {selectedRecorderDetail.policyDecisions.map(policy => (
                <div
                  key={policy.id}
                  className="rounded-2xl bg-surface-container-low px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-bold text-on-surface">
                      {policy.actionType}
                    </p>
                    <StatusBadge tone={getStatusTone(policy.decision)}>
                      {policy.decision}
                    </StatusBadge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    {policy.reason}
                  </p>
                </div>
              ))}
              {selectedRecorderDetail.policyDecisions.length === 0 && (
                <p className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-secondary">
                  No policy decisions are linked to this record.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <FolderArchive size={16} className="text-primary" />
              <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                Artifacts and handoffs
              </h3>
            </div>
            <div className="mt-4 space-y-3">
              {combinedArtifacts.map(artifact => (
                <button
                  key={artifact.artifactId}
                  type="button"
                  onClick={() => {
                    setTab('artifacts');
                    setSelectedArtifactId(artifact.artifactId);
                  }}
                  className="flex w-full items-center justify-between rounded-2xl bg-surface-container-low px-4 py-4 text-left transition-all hover:bg-primary/5"
                >
                  <div>
                    <p className="text-sm font-bold text-on-surface">{artifact.name}</p>
                    <p className="mt-1 text-xs text-secondary">
                      {summarizeKind(artifact.kind)} • {formatTimestamp(artifact.createdAt)}
                    </p>
                  </div>
                  <ArrowRight size={14} className="text-primary" />
                </button>
              ))}
              {combinedArtifacts.length === 0 && (
                <p className="rounded-2xl bg-surface-container-low px-4 py-4 text-sm text-secondary">
                  No artifacts or handoffs are linked to this record.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Evidence Hub"
        context={activeCapability.id}
        title={`${activeCapability.name} Ledger`}
        description="Audit-ready workspace for phase artifacts, handoff packets, completed work-order evidence, approvals, human comments, logs, and downloadable delivery bundles."
        actions={
          <button
            type="button"
            onClick={() => {
              setIsLoading(true);
              Promise.all([
                fetchLedgerArtifacts(activeCapability.id),
                fetchCompletedWorkOrders(activeCapability.id),
                fetchCapabilityFlightRecorder(activeCapability.id),
              ])
                .then(([artifactRecords, summaries, recorderSnapshot]) => {
                  setArtifacts(artifactRecords);
                  setCompletedOrders(summaries);
                  setFlightRecorder(recorderSnapshot);
                  if (!selectedWorkItemId) {
                    setSelectedWorkItemId(
                      summaries[0]?.workItem.id ||
                        recorderSnapshot.workItems[0]?.workItem.id ||
                        '',
                    );
                  }
                  if (!selectedArtifactId) {
                    setSelectedArtifactId(artifactRecords[0]?.artifact.id || '');
                  }
                })
                .catch(nextError => {
                  setError(
                    nextError instanceof Error
                      ? nextError.message
                      : 'Ledger evidence could not be refreshed.',
                  );
                })
                .finally(() => setIsLoading(false));
            }}
            className="enterprise-button enterprise-button-secondary"
          >
            <RefreshCw size={16} />
            Refresh evidence
          </button>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Artifacts', value: stats.artifacts, icon: FileText },
          { label: 'Completed Orders', value: stats.completed, icon: CheckCircle2 },
          { label: 'Handoff Packets', value: stats.handoffs, icon: GitMerge },
          { label: 'Human gates', value: stats.interactions, icon: ShieldCheck },
        ].map(item => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="stat-tile"
          >
            <StatTile
              label={item.label}
              value={item.value}
              icon={item.icon}
              tone="brand"
              className="border-0 bg-transparent px-0 py-0 shadow-none"
            />
          </motion.div>
        ))}
      </section>

      <Toolbar className="items-stretch">
        <nav className="flex flex-wrap gap-2">
          {LEDGER_PRIMARY_TABS.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-all',
                tab === item.id
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-secondary hover:bg-surface-container-low hover:text-primary',
              )}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </nav>
        <AdvancedDisclosure
          title="Advanced audit details"
          description="Human interaction records and raw logs remain available for audit and troubleshooting."
          storageKey="singularity.ledger.advanced.open"
          defaultOpen={tab === 'interactions' || tab === 'logs'}
          className="w-full bg-surface-container-low/70 shadow-none"
          contentClassName="pt-3"
          badge={
            <StatusBadge tone={tab === 'interactions' || tab === 'logs' ? 'brand' : 'neutral'}>
              {tab === 'interactions' || tab === 'logs' ? 'Viewing advanced' : 'Collapsed'}
            </StatusBadge>
          }
        >
          <nav className="flex flex-wrap gap-2">
            {LEDGER_ADVANCED_TABS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition-all',
                  tab === item.id
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-secondary hover:bg-white hover:text-primary',
                )}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </nav>
        </AdvancedDisclosure>
      </Toolbar>

      {tab === 'flight-recorder' && flightRecorder && (
        <section className="rounded-[2rem] border border-primary/10 bg-primary/5 p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={getVerdictTone(selectedRecorderDetail?.verdict || flightRecorder.verdict)}
                >
                  {selectedRecorderDetail?.verdict || flightRecorder.verdict}
                </StatusBadge>
                <span className="page-context">
                  Generated {formatTimestamp(flightRecorder.generatedAt)}
                </span>
                {selectedRecorderDetail && (
                  <span className="page-context">{selectedRecorderDetail.workItem.id}</span>
                )}
              </div>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-primary">
                Work Item Flight Recorder
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-secondary">
                {selectedRecorderDetail?.verdictReason || flightRecorder.verdictReason}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedRecorderDetail ? (
                <>
                  <a
                    href={getWorkItemFlightRecorderDownloadUrl(
                      activeCapability.id,
                      selectedRecorderDetail.workItem.id,
                      'markdown',
                    )}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    <Download size={16} />
                    Markdown
                  </a>
                  <a
                    href={getWorkItemFlightRecorderDownloadUrl(
                      activeCapability.id,
                      selectedRecorderDetail.workItem.id,
                      'json',
                    )}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    <Download size={16} />
                    JSON
                  </a>
                </>
              ) : (
                <a
                  href={getCapabilityFlightRecorderDownloadUrl(
                    activeCapability.id,
                    'markdown',
                  )}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Download size={16} />
                  Capability export
                </a>
              )}
              <button
                type="button"
                onClick={() =>
                  selectedRecorderDetail
                    ? navigate(
                        `/orchestrator?selected=${encodeURIComponent(
                          selectedRecorderDetail.workItem.id,
                        )}`,
                      )
                    : navigate('/orchestrator')
                }
                className="enterprise-button enterprise-button-primary"
              >
                <ExternalLink size={16} />
                Open work
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              [
                'Gates',
                selectedRecorderDetail
                  ? selectedRecorderDetail.humanGates.length
                  : flightRecorder.summary.openHumanGateCount,
              ],
              [
                'Policies',
                selectedRecorderDetail
                  ? selectedRecorderDetail.policyDecisions.length
                  : flightRecorder.summary.policyDecisionCount,
              ],
              [
                'Evidence',
                selectedRecorderDetail
                  ? selectedRecorderDetail.artifacts.length
                  : flightRecorder.summary.evidenceArtifactCount,
              ],
              [
                'Handoffs',
                selectedRecorderDetail
                  ? selectedRecorderDetail.handoffArtifacts.length
                  : flightRecorder.summary.handoffPacketCount,
              ],
              [
                'Tools',
                selectedRecorderDetail
                  ? selectedRecorderDetail.telemetry.toolInvocationCount
                  : flightRecorder.summary.completedWorkCount,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-primary/10 bg-white px-4 py-3"
              >
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                  {label}
                </p>
                <p className="mt-2 text-2xl font-extrabold text-primary">{value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div
        className={cn(
          'grid gap-6',
          tab === 'flight-recorder'
            ? 'xl:grid-cols-1'
            : 'xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]',
        )}
      >
        <aside className={cn('space-y-5', tab === 'flight-recorder' && 'hidden')}>
          {(tab === 'artifacts' || tab === 'interactions') && (
            <>
              <FilterBar>
                <div className="mb-4 flex items-center gap-2">
                  <Filter size={16} className="text-primary" />
                  <h2 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                    Filter Evidence
                  </h2>
                </div>
                <div className="grid gap-3">
                  <input
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="Search artifact or work item"
                    className="field-input"
                  />
                  <select
                    value={phaseFilter}
                    onChange={event => setPhaseFilter(event.target.value)}
                    className="field-select"
                  >
                    <option value="ALL">All phases</option>
                    {artifactPhaseOptions.map(option => (
                      <option key={option} value={option}>
                        {formatPhase(option as WorkItemPhase)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={kindFilter}
                    onChange={event => setKindFilter(event.target.value)}
                    className="field-select"
                  >
                    <option value="ALL">All artifact kinds</option>
                    {artifactKindOptions.map(option => (
                      <option key={option} value={option}>
                        {summarizeKind(option)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={agentFilter}
                    onChange={event => setAgentFilter(event.target.value)}
                    className="field-select"
                  >
                    <option value="ALL">All agents</option>
                    {artifactAgentOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <select
                    value={attemptFilter}
                    onChange={event => setAttemptFilter(event.target.value)}
                    className="field-select"
                  >
                    <option value="ALL">All attempts</option>
                    {artifactAttemptOptions.map(option => (
                      <option key={option} value={String(option)}>
                        Attempt {option}
                      </option>
                    ))}
                  </select>
                </div>
              </FilterBar>

              {renderArtifactList()}
            </>
          )}

          {(tab === 'completed' || tab === 'logs') && renderCompletedOrderList()}
        </aside>

        <section className="space-y-6">
          {isLoading ? (
            <EmptyState
              title="Loading Ledger evidence"
              description="Refreshing durable artifacts, phase outputs, and completed work-order evidence."
              icon={Clock3}
            />
          ) : null}

          {(tab === 'artifacts' || tab === 'interactions') && !isLoading && selectedArtifact && (
            <>
              <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-primary">
                        {summarizeKind(selectedArtifact.artifact.artifactKind)}
                      </span>
                      {selectedArtifact.artifact.phase && (
                        <span className="rounded-full bg-surface-container-high px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-secondary">
                          {formatPhase(selectedArtifact.artifact.phase)}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-primary">
                      {selectedArtifact.artifact.name}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      {compactMarkdownPreview(
                        selectedArtifact.artifact.summary ||
                          selectedArtifact.artifact.description ||
                          'This evidence record is stored in the capability ledger.',
                        320,
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <a
                      href={getArtifactDownloadUrl(
                        activeCapability.id,
                        selectedArtifact.artifact.id,
                      )}
                      className="inline-flex items-center gap-2 rounded-2xl border border-outline-variant/15 bg-white px-4 py-3 text-sm font-bold text-secondary transition-all hover:bg-surface-container-low"
                    >
                      <Download size={16} />
                      Download
                    </a>
                    {selectedArtifact.artifact.workItemId && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/orchestrator?selected=${encodeURIComponent(
                              selectedArtifact.artifact.workItemId || '',
                            )}`,
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white transition-all hover:brightness-110"
                      >
                        <ExternalLink size={16} />
                        Open source work item
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-6 grid gap-3 text-sm text-secondary md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                      Work Order
                    </p>
                    <p className="mt-1 font-semibold text-on-surface">
                      {selectedArtifact.workItemTitle || selectedArtifact.artifact.workItemId || 'Not linked'}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                      Agent
                    </p>
                    <p className="mt-1 font-semibold text-on-surface">
                      {selectedArtifact.sourceAgentName ||
                        selectedArtifact.artifact.connectedAgentId ||
                        selectedArtifact.artifact.agent}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                      Created
                    </p>
                    <p className="mt-1 font-semibold text-on-surface">
                      {formatTimestamp(selectedArtifact.artifact.created)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                      Run
                    </p>
                    <p className="mt-1 font-semibold text-on-surface">
                      {selectedArtifact.artifact.sourceRunId ||
                        selectedArtifact.artifact.runId ||
                        'No run'}
                    </p>
                  </div>
                </div>
              </div>

              <PreviewPane content={selectedArtifactContent} />
            </>
          )}

          {tab === 'flight-recorder' && !isLoading && (
            <div className="space-y-6">
              {renderFlightRecorderWorkItemRail()}
              {renderControlTowerRecorder()}
              {renderRecorderAuditSections()}
            </div>
          )}

          {(tab === 'completed' || tab === 'logs') && !isLoading && (
            <>
              {!selectedWorkItemId ? (
                <div className="rounded-3xl border border-outline-variant/15 bg-white px-6 py-16 text-center text-sm text-secondary shadow-sm">
                  No completed work order is selected.
                </div>
              ) : isDetailLoading && !selectedEvidence ? (
                <div className="rounded-3xl border border-outline-variant/15 bg-white px-6 py-16 text-center text-sm text-secondary shadow-sm">
                  Loading completed work-order evidence...
                </div>
              ) : selectedEvidence ? (
                <>
                  <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-emerald-700">
                            Completed Work Order
                          </span>
                          {selectedEvidence.latestCompletedRun && (
                            <span className="rounded-full bg-surface-container-high px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em] text-secondary">
                              Attempt {selectedEvidence.latestCompletedRun.attemptNumber}
                            </span>
                          )}
                        </div>
                        <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-primary">
                          {selectedEvidence.workItem.title}
                        </h2>
                        <p className="mt-2 text-sm leading-relaxed text-secondary">
                          {selectedEvidence.workItem.description}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={getWorkItemEvidenceBundleDownloadUrl(
                            activeCapability.id,
                            selectedEvidence.workItem.id,
                          )}
                          className="inline-flex items-center gap-2 rounded-2xl border border-outline-variant/15 bg-white px-4 py-3 text-sm font-bold text-secondary transition-all hover:bg-surface-container-low"
                        >
                          <Download size={16} />
                          Download evidence bundle
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/orchestrator?selected=${encodeURIComponent(
                                selectedEvidence.workItem.id,
                              )}`,
                            )
                          }
                          className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white transition-all hover:brightness-110"
                        >
                          <ExternalLink size={16} />
                          Open in orchestrator
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {[
                        {
                          label: 'Artifacts',
                          value: selectedEvidence.artifacts.length,
                          icon: FileText,
                        },
                        {
                          label: 'Interactions',
                          value: selectedEvidence.humanInteractions.length,
                          icon: MessageSquareQuote,
                        },
                        {
                          label: 'Events',
                          value: selectedEvidence.events.length,
                          icon: Clock3,
                        },
                        {
                          label: 'Logs',
                          value: selectedEvidence.logs.length,
                          icon: TerminalSquare,
                        },
                      ].map(item => (
                        <div
                          key={item.label}
                          className="rounded-2xl bg-surface-container-low px-4 py-4"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                                {item.label}
                              </p>
                              <p className="mt-2 text-2xl font-extrabold text-primary">
                                {item.value}
                              </p>
                            </div>
                            <div className="rounded-2xl bg-white p-3 text-primary shadow-sm">
                              <item.icon size={16} />
                            </div>
                          </div>
                        </div>
                        ))}
                      </div>

                    <div className="mt-6 rounded-2xl bg-surface-container-low px-4 py-4">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                        Run History
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedEvidence.runHistory.map(run => (
                          <span
                            key={run.id}
                            className={cn(
                              'rounded-full px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-[0.14em]',
                              run.id === selectedEvidence.latestCompletedRun?.id
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-white text-secondary',
                            )}
                          >
                            Attempt {run.attemptNumber} • {run.status}
                          </span>
                        ))}
                        {selectedEvidence.runHistory.length === 0 && (
                          <span className="text-sm text-secondary">
                            No durable run history is available for this work order.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {tab === 'completed' && (
                    <>
                      <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-2">
                          <GitMerge size={16} className="text-primary" />
                          <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                            Phase Timeline and Handoffs
                          </h3>
                        </div>
                        <div className="mt-5 space-y-4">
                          {selectedEvidence.phaseGroups.map(group => (
                            <div
                              key={`${group.phase}-${group.stepName}`}
                              className="rounded-3xl border border-outline-variant/15 bg-surface-container-low px-5 py-5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="text-lg font-bold text-on-surface">
                                    {group.label}
                                  </p>
                                  <p className="mt-1 text-sm text-secondary">
                                    {group.stepName || 'Workflow step'} • {group.stepType || 'Step'}
                                  </p>
                                </div>
                                <span className="rounded-full bg-white px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-secondary">
                                  {group.artifacts.length + group.handoffArtifacts.length}{' '}
                                  evidence items
                                </span>
                              </div>

                              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                                <div className="rounded-2xl bg-white px-4 py-4">
                                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                                    Phase Artifacts
                                  </p>
                                  <div className="mt-3 space-y-2">
                                    {group.artifacts.map(record => (
                                      <button
                                        key={record.artifact.id}
                                        type="button"
                                        onClick={() => {
                                          setTab('artifacts');
                                          setSelectedArtifactId(record.artifact.id);
                                        }}
                                        className="flex w-full items-center justify-between rounded-2xl border border-outline-variant/10 px-3 py-3 text-left transition-all hover:bg-surface-container-low"
                                      >
                                        <span className="text-sm font-semibold text-on-surface">
                                          {record.artifact.name}
                                        </span>
                                        <ArrowRight size={14} className="text-primary" />
                                      </button>
                                    ))}
                                    {group.artifacts.length === 0 && (
                                      <p className="text-sm text-secondary">
                                        No phase artifact was recorded for this step.
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-2xl bg-white px-4 py-4">
                                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                                    Agent Handoffs
                                  </p>
                                  <div className="mt-3 space-y-2">
                                    {group.handoffArtifacts.map(record => (
                                      <button
                                        key={record.artifact.id}
                                        type="button"
                                        onClick={() => {
                                          setTab('artifacts');
                                          setSelectedArtifactId(record.artifact.id);
                                        }}
                                        className="flex w-full items-center justify-between rounded-2xl border border-outline-variant/10 px-3 py-3 text-left transition-all hover:bg-surface-container-low"
                                      >
                                        <span className="text-sm font-semibold text-on-surface">
                                          {record.artifact.name}
                                        </span>
                                        <ArrowRight size={14} className="text-primary" />
                                      </button>
                                    ))}
                                    {group.handoffArtifacts.length === 0 && (
                                      <p className="text-sm text-secondary">
                                        No explicit handoff packet was recorded here.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {(group.interactions.length > 0 || group.toolInvocations.length > 0) && (
                                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                                  <div className="rounded-2xl bg-white px-4 py-4">
                                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                                      Human Interactions
                                    </p>
                                    <div className="mt-3 space-y-3">
                                      {group.interactions.map(item => (
                                        <div
                                          key={item.id}
                                          className="rounded-2xl border border-outline-variant/10 px-3 py-3"
                                        >
                                          <p className="text-sm font-semibold text-on-surface">
                                            {item.message}
                                          </p>
                                          {item.resolution && (
                                            <p className="mt-2 text-xs leading-relaxed text-secondary">
                                              {item.resolution}
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="rounded-2xl bg-white px-4 py-4">
                                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                                      Tool Activity
                                    </p>
                                    <div className="mt-3 space-y-3">
                                      {group.toolInvocations.map(tool => (
                                        <div
                                          key={tool.id}
                                          className="rounded-2xl border border-outline-variant/10 px-3 py-3"
                                        >
                                          <p className="text-sm font-semibold text-on-surface">
                                            {tool.toolId}
                                          </p>
                                          <p className="mt-1 text-xs text-secondary">
                                            {tool.resultSummary || 'Tool invocation recorded.'}
                                          </p>
                                        </div>
                                      ))}
                                      {group.toolInvocations.length === 0 && (
                                        <p className="text-sm text-secondary">
                                          No tool-backed execution was recorded for this step.
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}

                          {selectedEvidence.phaseGroups.length === 0 && (
                            <div className="rounded-3xl border border-dashed border-outline-variant/20 bg-surface-container-low px-5 py-12 text-center text-sm text-secondary">
                              No phase evidence is available for this work order yet.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-2">
                          <ShieldCheck size={16} className="text-primary" />
                          <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                            Approvals, Inputs, and Resolutions
                          </h3>
                        </div>
                        <div className="mt-5">
                          <InteractionTimeline items={selectedEvidence.humanInteractions} />
                        </div>
                      </div>
                    </>
                  )}

                  {tab === 'logs' && (
                    <>
                      <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-2">
                          <Clock3 size={16} className="text-primary" />
                          <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                            Run Event Timeline
                          </h3>
                        </div>
                        <div className="mt-5 space-y-3">
                          {selectedEvidence.events.map(event => (
                            <div
                              key={event.id}
                              className="rounded-3xl border border-outline-variant/15 bg-surface-container-low px-5 py-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-bold text-on-surface">
                                    {event.message}
                                  </p>
                                  <p className="mt-1 text-xs text-secondary">
                                    {event.type} • {formatTimestamp(event.timestamp)}
                                  </p>
                                </div>
                                <span
                                  className={cn(
                                    'rounded-full px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.14em]',
                                    event.level === 'ERROR'
                                      ? 'bg-red-100 text-red-700'
                                      : event.level === 'WARN'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-primary/10 text-primary',
                                  )}
                                >
                                  {event.level}
                                </span>
                              </div>
                            </div>
                          ))}
                          {selectedEvidence.events.length === 0 && (
                            <div className="rounded-3xl border border-dashed border-outline-variant/20 bg-surface-container-low px-5 py-12 text-center text-sm text-secondary">
                              No run events were captured for this work order.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-2">
                          <FileSearch size={16} className="text-primary" />
                          <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                            Execution Logs
                          </h3>
                        </div>
                        <div className="mt-5 space-y-3">
                          {selectedEvidence.logs.map(log => (
                            <div
                              key={log.id}
                              className="rounded-3xl border border-outline-variant/15 bg-surface-container-low px-5 py-4"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-bold text-on-surface">{log.message}</p>
                                  <p className="mt-1 text-xs text-secondary">
                                    {formatTimestamp(log.timestamp)} • {log.agentId}
                                  </p>
                                </div>
                                <span
                                  className={cn(
                                    'rounded-full px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.14em]',
                                    log.level === 'ERROR'
                                      ? 'bg-red-100 text-red-700'
                                      : log.level === 'WARN'
                                      ? 'bg-amber-100 text-amber-700'
                                      : 'bg-primary/10 text-primary',
                                  )}
                                >
                                  {log.level}
                                </span>
                              </div>
                              {log.metadata && (
                                <pre className="mt-3 overflow-auto rounded-2xl bg-white px-4 py-3 text-[0.75rem] leading-relaxed text-secondary">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                          {selectedEvidence.logs.length === 0 && (
                            <div className="rounded-3xl border border-dashed border-outline-variant/20 bg-surface-container-low px-5 py-12 text-center text-sm text-secondary">
                              No execution logs were captured for this work order.
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="rounded-3xl border border-outline-variant/15 bg-white px-6 py-16 text-center text-sm text-secondary shadow-sm">
                  No evidence is available for this work order yet.
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default Ledger;
