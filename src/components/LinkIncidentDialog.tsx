import React, { useEffect, useMemo, useState } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import {
  createIncidentRecord,
  linkIncidentPacket,
  listIncidents,
} from '../lib/api';
import type { CapabilityIncident, IncidentPacketLink } from '../types';

const severityOptions = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;

export const LinkIncidentDialog = ({
  capabilityId,
  packetBundleId,
  open,
  onClose,
  onLinked,
}: {
  capabilityId: string;
  packetBundleId: string;
  open: boolean;
  onClose: () => void;
  onLinked: (incident: CapabilityIncident, link: IncidentPacketLink) => void;
}) => {
  const { success, error: showError } = useToast();
  const [incidents, setIncidents] = useState<CapabilityIncident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState('');
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<(typeof severityOptions)[number]>('SEV2');
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const selectedIncident = useMemo(
    () => incidents.find(incident => incident.id === selectedIncidentId) || null,
    [incidents, selectedIncidentId],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setIsLoading(true);
    void listIncidents({ capabilityId })
      .then(items => {
        setIncidents(items);
        setSelectedIncidentId(items[0]?.id || '');
      })
      .catch(error => {
        showError(
          'Unable to load incidents',
          error instanceof Error ? error.message : 'Unable to load incidents.',
        );
      })
      .finally(() => setIsLoading(false));
  }, [capabilityId, open]);

  if (!open) {
    return null;
  }

  const handleLinkExisting = async () => {
    if (!selectedIncident) {
      showError('Select an incident', 'Pick an incident to link to this packet.');
      return;
    }
    setIsSaving(true);
    try {
      const link = await linkIncidentPacket(selectedIncident.id, {
        packetBundleId,
        correlation: 'SUSPECTED',
        correlationReasons: ['Linked from the packet review workspace.'],
      });
      success('Incident linked', `${selectedIncident.title} is now linked to this evidence packet.`);
      onLinked(selectedIncident, link);
      onClose();
    } catch (error) {
      showError(
        'Unable to link incident',
        error instanceof Error ? error.message : 'Unable to link incident.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateAndLink = async () => {
    if (!title.trim()) {
      showError('Add an incident title', 'Give the incident a short title before linking it.');
      return;
    }
    setIsSaving(true);
    try {
      const incident = await createIncidentRecord({
        capabilityId,
        title: title.trim(),
        severity,
        status: 'triggered',
        summary: summary.trim() || undefined,
        initialPacketBundleId: packetBundleId,
      });
      const link =
        incident.linkedPackets.find(item => item.packetBundleId === packetBundleId) ||
        (await linkIncidentPacket(incident.id, {
          packetBundleId,
          correlation: 'SUSPECTED',
          correlationReasons: ['Linked when the manual incident was created from the packet.'],
        }));
      success('Incident created', `${incident.title} was created and linked to this evidence packet.`);
      onLinked(incident, link);
      onClose();
    } catch (error) {
      showError(
        'Unable to create incident',
        error instanceof Error ? error.message : 'Unable to create incident.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8">
      <div className="w-full max-w-4xl rounded-[2rem] border border-outline-variant/40 bg-surface p-6 shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="form-kicker">Link Incident</p>
            <h2 className="mt-2 text-2xl font-semibold text-on-surface">
              Connect this packet to an incident
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Link the packet to an existing incident or create a manual incident in one step.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-outline-variant/50 bg-white p-2 text-secondary transition hover:text-on-surface"
            aria-label="Close incident dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[1.75rem] border border-outline-variant/40 bg-white p-5">
            <div className="flex items-center gap-2 text-on-surface">
              <Link2 size={18} />
              <h3 className="text-lg font-semibold">Link existing incident</h3>
            </div>
            <p className="mt-2 text-sm text-secondary">
              Pick an existing incident on this capability and mark the packet as a suspected contributor.
            </p>
            {isLoading ? (
              <p className="mt-5 text-sm text-secondary">Loading incidents…</p>
            ) : incidents.length === 0 ? (
              <p className="mt-5 text-sm text-secondary">No incidents exist yet for this capability.</p>
            ) : (
              <>
                <select
                  value={selectedIncidentId}
                  onChange={event => setSelectedIncidentId(event.target.value)}
                  className="input-field mt-5"
                >
                  {incidents.map(incident => (
                    <option key={incident.id} value={incident.id}>
                      {incident.id} · {incident.title}
                    </option>
                  ))}
                </select>
                {selectedIncident ? (
                  <div className="mt-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
                    <p className="text-sm font-semibold text-on-surface">{selectedIncident.title}</p>
                    <p className="mt-2 text-xs text-secondary">
                      {selectedIncident.severity} · {selectedIncident.status}
                    </p>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleLinkExisting()}
                  disabled={isSaving || !selectedIncident}
                  className="enterprise-button enterprise-button-secondary mt-5"
                >
                  Link to selected incident
                </button>
              </>
            )}
          </div>

          <div className="rounded-[1.75rem] border border-primary/20 bg-primary/5 p-5">
            <div className="flex items-center gap-2 text-primary">
              <Plus size={18} />
              <h3 className="text-lg font-semibold">Create manual incident</h3>
            </div>
            <p className="mt-2 text-sm text-secondary">
              Use this when SRE has not opened an incident yet and you want to start attribution from the packet.
            </p>
            <label className="mt-5 block text-sm font-medium text-on-surface">
              Incident title
            </label>
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              className="input-field mt-2"
              placeholder="Production incident title"
            />
            <label className="mt-4 block text-sm font-medium text-on-surface">Severity</label>
            <select
              value={severity}
              onChange={event => setSeverity(event.target.value as (typeof severityOptions)[number])}
              className="input-field mt-2"
            >
              {severityOptions.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <label className="mt-4 block text-sm font-medium text-on-surface">Summary</label>
            <textarea
              value={summary}
              onChange={event => setSummary(event.target.value)}
              className="input-field mt-2 min-h-[8rem]"
              placeholder="What happened, which service is impacted, and why this packet is worth reviewing."
            />
            <button
              type="button"
              onClick={() => void handleCreateAndLink()}
              disabled={isSaving}
              className="enterprise-button enterprise-button-primary mt-5"
            >
              Create incident and link packet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LinkIncidentDialog;
