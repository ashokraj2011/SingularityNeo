import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { EnterpriseTone } from '../lib/enterprise';

const TONE_STYLES: Record<EnterpriseTone, string> = {
  neutral:
    'border-outline-variant/50 bg-surface-container-low text-secondary',
  brand: 'border-primary/15 bg-primary/10 text-primary',
  info: 'border-secondary/15 bg-secondary-container/50 text-secondary',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-700',
};

export const StatusBadge = ({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: EnterpriseTone;
  className?: string;
}) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em]',
      TONE_STYLES[tone],
      className,
    )}
  >
    {children}
  </span>
);

export const PageHeader = ({
  eyebrow,
  context,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  context?: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) => (
  <header className="page-header">
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="brand">{eyebrow}</StatusBadge>
        {context ? <span className="page-context">{context}</span> : null}
      </div>
      <div className="space-y-2">
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{description}</p>
      </div>
      {children}
    </div>
    {actions ? <div className="page-actions">{actions}</div> : null}
  </header>
);

export const Toolbar = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={cn('toolbar-shell', className)}>{children}</div>;

export const SectionCard = ({
  title,
  description,
  action,
  icon: Icon,
  tone = 'default',
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'muted' | 'brand';
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) => (
  <section
    className={cn(
      'section-card',
      tone === 'muted' && 'section-card-muted',
      tone === 'brand' && 'section-card-brand',
      className,
    )}
  >
    <div className="section-card-header">
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="section-card-icon">
            <Icon size={18} />
          </div>
        ) : null}
        <div>
          <h2 className="section-card-title">{title}</h2>
          {description ? (
            <p className="section-card-description">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    <div className={cn('space-y-4', contentClassName)}>{children}</div>
  </section>
);

export const StatTile = ({
  label,
  value,
  helper,
  icon: Icon,
  tone = 'neutral',
  className,
}: {
  key?: React.Key;
  label: string;
  value: React.ReactNode;
  helper?: React.ReactNode;
  icon?: LucideIcon;
  tone?: EnterpriseTone;
  className?: string;
}) => (
  <div className={cn('stat-tile', className)}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="stat-label">{label}</p>
        <p className={cn('stat-value', tone === 'danger' && 'text-red-700', tone === 'warning' && 'text-amber-700', tone === 'success' && 'text-emerald-700', tone === 'brand' && 'text-primary', tone === 'info' && 'text-secondary')}>
          {value}
        </p>
      </div>
      {Icon ? (
        <div className={cn('stat-icon', TONE_STYLES[tone])}>
          <Icon size={16} />
        </div>
      ) : null}
    </div>
    {helper ? <div className="stat-helper">{helper}</div> : null}
  </div>
);

export const EmptyState = ({
  title,
  description,
  icon: Icon,
  action,
  className,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('empty-state', className)}>
    {Icon ? (
      <div className="empty-state-icon">
        <Icon size={20} />
      </div>
    ) : null}
    <div className="space-y-2">
      <h3 className="text-lg font-bold text-on-surface">{title}</h3>
      <p className="mx-auto max-w-md text-sm leading-relaxed text-secondary">
        {description}
      </p>
    </div>
    {action ? <div>{action}</div> : null}
  </div>
);

export const FilterBar = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={cn('filter-bar', className)}>{children}</div>;

export const DrawerShell = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => <aside className={cn('drawer-shell', className)}>{children}</aside>;

export const ModalShell = ({
  title,
  description,
  eyebrow,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('modal-shell', className)}>
    <div className="modal-shell-header">
      <div className="space-y-2">
        {eyebrow ? <p className="form-kicker">{eyebrow}</p> : null}
        <h2 className="text-2xl font-bold tracking-tight text-on-surface">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
    {children}
  </div>
);

export const FormSection = ({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <section className={cn('space-y-5', className)}>
    <div className="form-section-header">
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="section-card-icon">
            <Icon size={18} />
          </div>
        ) : null}
        <div>
          <h2 className="section-card-title">{title}</h2>
          <p className="section-card-description">{description}</p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    {children}
  </section>
);

export const KeyValueList = ({
  items,
  className,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
  className?: string;
}) => (
  <dl className={cn('key-value-list', className)}>
    {items.map(item => (
      <div key={item.label} className="key-value-row">
        <dt className="key-value-label">{item.label}</dt>
        <dd className="key-value-value">{item.value}</dd>
      </div>
    ))}
  </dl>
);

export const DataTable = ({
  header,
  children,
  className,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('data-table-shell', className)}>
    <div className="data-table-header">{header}</div>
    <div>{children}</div>
  </div>
);

export const BoardColumn = ({
  title,
  count,
  badge,
  children,
  active,
  className,
}: {
  key?: React.Key;
  title: string;
  count: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}) => (
  <div className={cn('board-column', active && 'board-column-active', className)}>
    <div className="board-column-header">
      <div>
        <p className="form-kicker">{title}</p>
        <p className="mt-2 text-2xl font-bold tracking-tight text-on-surface">
          {count}
        </p>
      </div>
      {badge}
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);
