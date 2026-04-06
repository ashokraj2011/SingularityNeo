import React, { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Database,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  fetchMemoryDocuments,
  refreshCapabilityMemoryIndex,
  searchCapabilityMemory,
} from '../lib/api';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import {
  EmptyState,
  KeyValueList,
  PageHeader,
  SectionCard,
  StatTile,
  Toolbar,
} from '../components/EnterpriseUI';
import { formatEnumLabel } from '../lib/enterprise';
import type { MemoryDocument, MemorySearchResult } from '../types';

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

const MemoryExplorer = () => {
  const { activeCapability } = useCapability();
  const { success } = useToast();
  const [documents, setDocuments] = useState<MemoryDocument[]>([]);
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [query, setQuery] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');

  const loadDocuments = async () => {
    try {
      const nextDocuments = await fetchMemoryDocuments(activeCapability.id);
      setDocuments(nextDocuments);
      setSelectedDocumentId(current => current || nextDocuments[0]?.id || '');
      setError('');
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to load capability memory.',
      );
    }
  };

  useEffect(() => {
    void loadDocuments();
    setResults([]);
    setQuery('');
  }, [activeCapability.id]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const refreshed = await refreshCapabilityMemoryIndex(activeCapability.id);
      setDocuments(refreshed);
      setSelectedDocumentId(current => current || refreshed[0]?.id || '');
      setError('');
      success(
        'Memory refreshed',
        `${activeCapability.name} memory index was rebuilt successfully.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to refresh capability memory.',
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const nextResults = await searchCapabilityMemory(
        activeCapability.id,
        query.trim(),
      );
      setResults(nextResults);
      setSelectedDocumentId(nextResults[0]?.document.id || '');
      setError('');
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Memory search failed.',
      );
    } finally {
      setIsSearching(false);
    }
  };

  const selectedDocument = useMemo(
    () =>
      documents.find(document => document.id === selectedDocumentId) ||
      results.find(result => result.document.id === selectedDocumentId)?.document ||
      null,
    [documents, results, selectedDocumentId],
  );

  const selectedResult = useMemo(
    () => results.find(result => result.document.id === selectedDocumentId) || null,
    [results, selectedDocumentId],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Knowledge"
        context={activeCapability.id}
        title={`${activeCapability.name} Memory Explorer`}
        description="Hierarchical working, session, and long-term memory with provenance-backed retrieval for chat and workflow execution."
        actions={
          <button
            type="button"
            className="enterprise-button enterprise-button-secondary"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh Memory
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatTile
          label="Memory Documents"
          value={documents.length}
          helper="Capability-scoped knowledge sources"
          icon={Database}
          tone="brand"
        />
        <StatTile
          label="Search Hits"
          value={results.length}
          helper="Current retrieval results"
          icon={Search}
          tone="info"
        />
        <StatTile
          label="Selected Tier"
          value={selectedDocument?.tier ? formatEnumLabel(selectedDocument.tier) : 'None'}
          helper={selectedDocument?.sourceType ? formatEnumLabel(selectedDocument.sourceType) : 'Select a memory document'}
          icon={BrainCircuit}
          tone="success"
        />
      </div>

      <SectionCard
        title="Retrieval Console"
        description="Search across capability memory and inspect the exact document/chunk provenance used by the backend."
        icon={Search}
      >
        <Toolbar className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="space-y-2">
            <span className="form-kicker">Search Memory</span>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleSearch();
                }
              }}
              placeholder="Search capability facts, artifacts, handoffs, and prior sessions"
              className="field-input"
            />
          </label>
          <button
            type="button"
            className="enterprise-button enterprise-button-primary mt-auto"
            onClick={() => void handleSearch()}
            disabled={isSearching}
          >
            <Search size={16} />
            Search
          </button>
        </Toolbar>
      </SectionCard>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.9fr)]">
        <SectionCard
          title={results.length > 0 ? 'Search Results' : 'Memory Catalog'}
          description={
            results.length > 0
              ? 'Ranked retrieval results with chunk-level provenance.'
              : 'Capability-scoped memory documents currently indexed.'
          }
          icon={BrainCircuit}
        >
          {(results.length > 0 ? results : documents.map(document => ({ document } as MemorySearchResult))).length === 0 ? (
            <EmptyState
              title="No memory indexed yet"
              description="Refresh the capability memory index to ingest capability metadata, artifacts, work items, and recent chat."
              icon={Database}
            />
          ) : (
            <div className="space-y-3">
              {(results.length > 0
                ? results
                : documents.map(document => ({ document } as MemorySearchResult))
              ).map(item => (
                <button
                  key={item.document.id}
                  type="button"
                  onClick={() => setSelectedDocumentId(item.document.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                    selectedDocumentId === item.document.id
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-outline-variant/40 bg-white hover:bg-surface-container-low'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{item.document.title}</p>
                      <p className="text-xs text-secondary">
                        {formatEnumLabel(item.document.sourceType)} • {formatEnumLabel(item.document.tier)}
                      </p>
                    </div>
                    {item.reference?.score !== undefined ? (
                      <span className="text-xs font-bold text-primary">
                        {(item.reference.score * 100).toFixed(0)}%
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-secondary">
                    {item.chunk?.content || item.document.contentPreview}
                  </p>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Selected Memory"
          description="Inspect provenance, freshness, and the exact chunk text returned to the runtime."
          icon={Database}
        >
          {selectedDocument ? (
            <div className="space-y-5">
              <KeyValueList
                items={[
                  { label: 'Source Type', value: formatEnumLabel(selectedDocument.sourceType) },
                  { label: 'Tier', value: formatEnumLabel(selectedDocument.tier) },
                  { label: 'Freshness', value: selectedDocument.freshness || 'Unknown' },
                  { label: 'Updated', value: formatTimestamp(selectedDocument.updatedAt) },
                ]}
              />
              <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-4">
                <p className="form-kicker">Preview</p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
                  {selectedResult?.chunk.content || selectedDocument.contentPreview}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Select a memory document"
              description="Choose a document or search result on the left to inspect its provenance and preview."
              icon={BrainCircuit}
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
};

export default MemoryExplorer;
