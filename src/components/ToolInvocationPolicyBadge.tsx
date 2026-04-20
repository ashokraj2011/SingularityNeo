import { useEffect, useId, useRef, useState } from 'react';
import type { EnterpriseTone } from '../lib/enterprise';
import type { FlightRecorderPolicySummary, PolicyDecisionResult } from '../types';
import { StatusBadge } from './EnterpriseUI';
import { cn } from '../lib/utils';

export type ToolInvocationPolicyDecision = FlightRecorderPolicySummary & {
  exceptionId?: string | null;
  exceptionExpiresAt?: string | null;
};

export const decisionTone = (decision: PolicyDecisionResult | string | undefined): EnterpriseTone => {
  if (decision === 'ALLOW') return 'success';
  if (decision === 'DENY') return 'danger';
  if (decision === 'REQUIRE_APPROVAL') return 'warning';
  return 'neutral';
};

const decisionLabel = (decision: PolicyDecisionResult | string) => {
  if (decision === 'ALLOW') return 'allowed';
  if (decision === 'DENY') return 'denied';
  if (decision === 'REQUIRE_APPROVAL') return 'requires approval';
  return String(decision).toLowerCase();
};

export const findDecisionForTool = (
  toolInvocationId: string | undefined,
  decisions: ReadonlyArray<ToolInvocationPolicyDecision> | undefined,
): ToolInvocationPolicyDecision | undefined => {
  if (!toolInvocationId || !decisions || decisions.length === 0) return undefined;
  return decisions.find(item => item.toolInvocationId === toolInvocationId);
};

const formatInstant = (iso?: string | null): string => {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
};

interface Props {
  toolInvocationId?: string;
  policyDecisions: ReadonlyArray<ToolInvocationPolicyDecision>;
  className?: string;
}

/**
 * Small clickable verdict chip rendered alongside a tool invocation. Joins
 * the parallel arrays (`toolInvocations` ↔ `policyDecisions`) on the wire by
 * `policy.toolInvocationId === tool.id`, then renders a StatusBadge whose
 * tone reflects the decision. Click toggles an accessible popover that
 * shows the full decision body. If no decision matches, renders nothing —
 * not every tool invocation is policy-gated.
 */
export const ToolInvocationPolicyBadge = ({
  toolInvocationId,
  policyDecisions,
  className,
}: Props) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const popoverId = useId();

  const decision = findDecisionForTool(toolInvocationId, policyDecisions);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!decision) return null;

  const tone = decisionTone(decision.decision);
  const accessibleName = `Policy: ${decisionLabel(decision.decision)} — reason: ${decision.reason}`;
  const tooltipParts = [
    `Decision: ${decision.decision}`,
    `Action: ${decision.actionType}`,
    `Reason: ${decision.reason}`,
  ];
  if (decision.exceptionId) {
    tooltipParts.push(`Exception: ${decision.exceptionId}`);
  }
  const tooltip = tooltipParts.join('\n');

  return (
    <span ref={containerRef} className={cn('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={accessibleName}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title={tooltip}
        onClick={() => setOpen(value => !value)}
        className="inline-flex cursor-pointer items-center rounded-full border border-transparent bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <StatusBadge tone={tone}>{decision.decision}</StatusBadge>
      </button>
      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label={`Policy decision for ${decision.actionType}`}
          className="absolute left-0 top-full z-30 mt-2 w-72 rounded-2xl border border-outline-variant/40 bg-white p-4 text-left text-xs leading-relaxed text-secondary shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <StatusBadge tone={tone}>{decision.decision}</StatusBadge>
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-outline">
              {decision.actionType}
            </span>
          </div>
          <p className="text-on-surface">{decision.reason}</p>
          <dl className="mt-3 space-y-1">
            {decision.exceptionId ? (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-outline">Exception</dt>
                <dd className="text-on-surface">{decision.exceptionId}</dd>
              </div>
            ) : null}
            {decision.exceptionExpiresAt ? (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-outline">Expires</dt>
                <dd className="text-on-surface">{formatInstant(decision.exceptionExpiresAt)}</dd>
              </div>
            ) : null}
            {decision.requestedByName ? (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-outline">Requested by</dt>
                <dd className="text-on-surface">{decision.requestedByName}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="font-semibold text-outline">Decided</dt>
              <dd className="text-on-surface">{formatInstant(decision.createdAt)}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </span>
  );
};

export default ToolInvocationPolicyBadge;
