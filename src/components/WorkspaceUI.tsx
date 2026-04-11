import React, { useEffect, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { readViewPreference, writeViewPreference } from '../lib/viewPreferences';
import { StatusBadge } from './EnterpriseUI';
import type { EnterpriseTone } from '../lib/enterprise';

export const WorkspaceShell = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={cn('space-y-4 pb-6', className)}>{children}</div>;

export const CommandBar = ({
  eyebrow,
  title,
  description,
  status,
  actions,
  children,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  status?: Array<{ label: React.ReactNode; tone?: EnterpriseTone }>;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) => (
  <section className={cn('workspace-command-strip', className)}>
    <div className="min-w-0 flex-1">
      {eyebrow ? <p className="form-kicker">{eyebrow}</p> : null}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="page-title">{title}</h1>
        {status?.map((item, index) => (
          <span key={index}>
            <StatusBadge tone={item.tone || 'neutral'}>{item.label}</StatusBadge>
          </span>
        ))}
      </div>
      {description ? <p className="page-subtitle mt-2">{description}</p> : null}
      {children}
    </div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
  </section>
);

export const RightRail = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <aside className={cn('workspace-surface min-h-[40rem] xl:sticky xl:top-4', className)}>
    {children}
  </aside>
);

export const QuickSheet = ({
  title,
  eyebrow,
  description,
  onClose,
  footer,
  children,
  className,
}: {
  title: string;
  eyebrow?: string;
  description?: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className="fixed inset-0 z-[90]">
    <button
      type="button"
      aria-label={`Close ${title}`}
      onClick={onClose}
      className="absolute inset-0 bg-slate-950/35"
    />
    <aside className={cn('quick-sheet-shell', className)}>
      <div className="quick-sheet-header">
        <div>
          {eyebrow ? <p className="form-kicker">{eyebrow}</p> : null}
          <h2 className="mt-1 text-xl font-bold text-on-surface">{title}</h2>
          {description ? (
            <p className="mt-2 text-sm leading-relaxed text-secondary">{description}</p>
          ) : null}
        </div>
        <button type="button" onClick={onClose} className="workspace-list-action">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      {footer ? <div className="quick-sheet-footer">{footer}</div> : null}
    </aside>
  </div>
);

export const StatusChipGroup = ({
  items,
  className,
}: {
  items: Array<{ label: React.ReactNode; value?: React.ReactNode; tone?: EnterpriseTone }>;
  className?: string;
}) => (
  <div className={cn('flex flex-wrap items-center gap-2', className)}>
    {items.map((item, index) => (
      <span
        key={index}
        className="inline-flex items-center gap-2 rounded-2xl border border-outline-variant/40 bg-white px-3 py-2 text-sm font-semibold text-on-surface"
      >
        <StatusBadge tone={item.tone || 'neutral'}>{item.label}</StatusBadge>
        {item.value !== undefined ? <span>{item.value}</span> : null}
      </span>
    ))}
  </div>
);

export const AdvancedDisclosure = ({
  title = 'Advanced',
  description,
  storageKey,
  defaultOpen = false,
  openSignal,
  badge,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: React.ReactNode;
  storageKey?: string;
  defaultOpen?: boolean;
  openSignal?: number;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) => {
  const [isOpen, setIsOpen] = useState(() => {
    if (!storageKey) {
      return defaultOpen;
    }

    return (
      readViewPreference<'open' | 'closed'>(
        storageKey,
        defaultOpen ? 'open' : 'closed',
        { allowed: ['open', 'closed'] as const },
      ) === 'open'
    );
  });

  useEffect(() => {
    if (storageKey) {
      writeViewPreference(storageKey, isOpen ? 'open' : 'closed');
    }
  }, [isOpen, storageKey]);

  useEffect(() => {
    if (openSignal) {
      setIsOpen(true);
    }
  }, [openSignal]);

  return (
    <section
      className={cn(
        'rounded-3xl border border-outline-variant/50 bg-white shadow-[0_10px_26px_rgba(12,23,39,0.04)]',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setIsOpen(current => !current)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        aria-expanded={isOpen}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-on-surface">{title}</p>
            {badge ? <span>{badge}</span> : null}
          </div>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-secondary">{description}</p>
          ) : null}
        </div>
        <ChevronDown
          size={18}
          className={cn(
            'shrink-0 text-outline transition-transform',
            isOpen && 'rotate-180 text-primary',
          )}
        />
      </button>
      {isOpen ? (
        <div className={cn('border-t border-outline-variant/40 px-5 py-5', contentClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
};
