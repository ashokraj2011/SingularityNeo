import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Layers, Link2, Loader2, Search, Users } from 'lucide-react';
import { getChatParticipants } from '../../lib/api';
import { StatusBadge } from '../EnterpriseUI';
import { cn } from '../../lib/utils';
import type {
  ChatParticipantDirectory,
  ChatParticipantDirectoryEntry,
} from '../../types';

/**
 * `@`-triggered picker for tagging agents across linked capabilities.
 *
 * The picker loads the capability's `ChatParticipantDirectory` once on open
 * and groups entries by source bucket (current / parent / children / shared).
 * Empty buckets are omitted so operators don't scroll past blank sections.
 *
 * Selection is additive — tagging the same agent twice is a no-op upstream.
 * Tagging >3 is blocked at the composer/server layer, not here, because the
 * picker has no opinion about how many tags the caller's flow accepts.
 */
export interface TaggedParticipant {
  capabilityId: string;
  capabilityName: string;
  agentId: string;
  agentName: string;
  bucket: keyof ChatParticipantDirectory;
}

type Props = {
  open: boolean;
  anchorCapabilityId: string;
  /** Currently-tagged participants so they can be highlighted / deduped. */
  selected: TaggedParticipant[];
  onSelect: (participant: TaggedParticipant) => void;
  onDismiss: () => void;
  /** Optional visual cap — usually 3 for swarm, but we don't enforce it here. */
  maxSelections?: number;
};

const BUCKET_META: Record<
  keyof ChatParticipantDirectory,
  { label: string; hint: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  current: {
    label: 'This capability',
    hint: 'Agents on the anchor capability.',
    icon: Users,
  },
  parent: {
    label: 'Parent',
    hint: 'Agents on the parent capability.',
    icon: ChevronDown,
  },
  children: {
    label: 'Child capabilities',
    hint: 'Agents from capabilities rolled up under this one.',
    icon: Layers,
  },
  shared: {
    label: 'Shared references',
    hint: 'Agents from capabilities explicitly shared with this one.',
    icon: Link2,
  },
};

const BUCKET_ORDER: Array<keyof ChatParticipantDirectory> = [
  'current',
  'parent',
  'children',
  'shared',
];

const matchesQuery = (entry: ChatParticipantDirectoryEntry, query: string) => {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  return (
    entry.agent.name.toLowerCase().includes(needle) ||
    entry.agent.role.toLowerCase().includes(needle) ||
    entry.capabilityName.toLowerCase().includes(needle)
  );
};

export const SwarmMentionPicker: React.FC<Props> = ({
  open,
  anchorCapabilityId,
  selected,
  onSelect,
  onDismiss,
  maxSelections,
}) => {
  const [directory, setDirectory] = useState<ChatParticipantDirectory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || !anchorCapabilityId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getChatParticipants(anchorCapabilityId)
      .then(next => {
        if (cancelled) return;
        setDirectory(next);
      })
      .catch(err => {
        if (cancelled) return;
        setError((err as Error).message || 'Failed to load participant directory.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, anchorCapabilityId]);

  const selectedKeys = useMemo(
    () => new Set(selected.map(p => `${p.capabilityId}::${p.agentId}`)),
    [selected],
  );

  const limitReached = typeof maxSelections === 'number' && selected.length >= maxSelections;

  if (!open) return null;

  const handleSelect = (bucket: keyof ChatParticipantDirectory, entry: ChatParticipantDirectoryEntry) => {
    const key = `${entry.capabilityId}::${entry.agent.id}`;
    if (selectedKeys.has(key)) return;
    if (limitReached) return;
    onSelect({
      capabilityId: entry.capabilityId,
      capabilityName: entry.capabilityName,
      agentId: entry.agent.id,
      agentName: entry.agent.name,
      bucket,
    });
  };

  const visibleBuckets = directory
    ? BUCKET_ORDER.filter(bucket => (directory[bucket] ?? []).length > 0)
    : [];

  return (
    <div
      role="dialog"
      aria-label="Tag an agent"
      className="absolute bottom-full left-0 z-20 mb-2 w-[min(24rem,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-outline-variant/50 bg-white shadow-[0_18px_40px_rgba(12,23,39,0.18)]"
    >
      <div className="flex items-center gap-2 border-b border-outline-variant/40 bg-surface-container-low px-3 py-2.5">
        <Search size={14} className="text-secondary" />
        <input
          autoFocus
          type="text"
          placeholder="Search agents by name, role, or capability…"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onDismiss();
            }
          }}
          className="flex-1 border-0 bg-transparent p-0 text-sm text-on-surface outline-none placeholder:text-secondary/70"
        />
        {limitReached ? (
          <StatusBadge tone="warning">Max {maxSelections}</StatusBadge>
        ) : null}
      </div>

      <div className="max-h-[22rem] overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-secondary">
            <Loader2 size={14} className="animate-spin" />
            Loading agents…
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-sm text-red-700">{error}</div>
        ) : !directory || visibleBuckets.length === 0 ? (
          <div className="px-3 py-4 text-sm text-secondary">
            No eligible agents. You need the <code>chat.participate</code> action on a
            linked capability (parent, child, or shared reference) before its agents
            appear here.
          </div>
        ) : (
          visibleBuckets.map(bucket => {
            const meta = BUCKET_META[bucket];
            const BucketIcon = meta.icon;
            const entries = (directory[bucket] ?? []).filter(entry =>
              matchesQuery(entry, query),
            );
            if (entries.length === 0) return null;
            return (
              <section key={bucket} className="mb-2 last:mb-0">
                <header className="flex items-center gap-2 px-2 pb-1 pt-2 text-[0.66rem] font-bold uppercase tracking-[0.18em] text-secondary">
                  <BucketIcon size={12} />
                  {meta.label}
                </header>
                <ul className="space-y-0.5">
                  {entries.map(entry => {
                    const key = `${entry.capabilityId}::${entry.agent.id}`;
                    const isSelected = selectedKeys.has(key);
                    const isDisabled = isSelected || limitReached;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => handleSelect(bucket, entry)}
                          disabled={isDisabled}
                          className={cn(
                            'flex w-full flex-col items-start gap-0.5 rounded-xl border border-transparent px-3 py-2 text-left transition',
                            isSelected
                              ? 'cursor-default border-primary/20 bg-primary/5'
                              : limitReached
                                ? 'cursor-not-allowed opacity-50'
                                : 'hover:border-outline-variant/50 hover:bg-surface-container-low',
                          )}
                        >
                          <div className="flex w-full items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-on-surface">
                              {entry.agent.name}
                            </p>
                            {isSelected ? (
                              <StatusBadge tone="brand">Tagged</StatusBadge>
                            ) : null}
                          </div>
                          <p className="truncate text-[0.72rem] text-secondary">
                            {entry.agent.role} · {entry.capabilityName}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <div className="border-t border-outline-variant/40 bg-surface-container-low px-3 py-2 text-[0.68rem] text-secondary">
        <span className="font-semibold uppercase tracking-[0.15em]">Esc</span> to close
        · Tag 2–3 agents to start a swarm debate
      </div>
    </div>
  );
};

export default SwarmMentionPicker;
