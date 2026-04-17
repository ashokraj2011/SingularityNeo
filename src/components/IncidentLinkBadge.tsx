import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { StatusBadge } from './EnterpriseUI';
import type { IncidentPacketLink } from '../types';

const correlationTone = (correlation?: IncidentPacketLink['correlation']) => {
  switch (correlation) {
    case 'CONFIRMED':
      return 'danger' as const;
    case 'SUSPECTED':
      return 'warning' as const;
    case 'BLAST_RADIUS':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
};

export const IncidentLinkBadge = ({
  link,
  compact = false,
}: {
  link: IncidentPacketLink;
  compact?: boolean;
}) => (
  <StatusBadge tone={correlationTone(link.correlation)}>
    <span className="inline-flex items-center gap-1">
      <AlertTriangle size={compact ? 11 : 12} />
      {compact ? link.correlation : `Incident ${link.correlation}`}
    </span>
  </StatusBadge>
);

export default IncidentLinkBadge;
