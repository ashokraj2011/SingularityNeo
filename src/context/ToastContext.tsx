import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '../lib/utils';

type ToastTone = 'success' | 'info' | 'warning' | 'danger';

type ToastItem = {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  durationMs: number;
};

type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastContextType = {
  notify: (input: ToastInput) => string;
  success: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const createToastId = () =>
  `TOAST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const toneStyles: Record<ToastTone, string> = {
  success: 'border-emerald-200/80 bg-white text-on-surface shadow-[0_18px_40px_rgba(16,185,129,0.12)]',
  info: 'border-sky-200/80 bg-white text-on-surface shadow-[0_18px_40px_rgba(14,165,233,0.12)]',
  warning: 'border-amber-200/80 bg-white text-on-surface shadow-[0_18px_40px_rgba(245,158,11,0.12)]',
  danger: 'border-red-200/80 bg-white text-on-surface shadow-[0_18px_40px_rgba(239,68,68,0.12)]',
};

const toneAccentStyles: Record<ToastTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  info: 'bg-sky-50 text-sky-700 border-sky-200/80',
  warning: 'bg-amber-50 text-amber-800 border-amber-200/80',
  danger: 'bg-red-50 text-red-700 border-red-200/80',
};

const toneIcons = {
  success: CheckCircle2,
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
} satisfies Record<ToastTone, React.ComponentType<{ size?: number; className?: string }>>;

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    window.clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const notify = useCallback(
    ({ title, description, tone = 'success', durationMs = 3200 }: ToastInput) => {
      const id = createToastId();
      setToasts(current => [...current, { id, title, description, tone, durationMs }]);
      timersRef.current[id] = window.setTimeout(() => {
        dismiss(id);
      }, durationMs);
      return id;
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      (Object.values(timersRef.current) as number[]).forEach(timer =>
        window.clearTimeout(timer),
      );
    },
    [],
  );

  const value = useMemo<ToastContextType>(
    () => ({
      notify,
      dismiss,
      success: (title, description) => notify({ title, description, tone: 'success' }),
      info: (title, description) => notify({ title, description, tone: 'info' }),
      warning: (title, description) => notify({ title, description, tone: 'warning' }),
      error: (title, description) => notify({ title, description, tone: 'danger', durationMs: 4200 }),
    }),
    [dismiss, notify],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 top-24 z-[120] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 lg:right-6 lg:top-28"
      >
        <AnimatePresence initial={false}>
          {toasts.map(toast => {
            const Icon = toneIcons[toast.tone];

            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className={cn(
                  'pointer-events-auto overflow-hidden rounded-2xl border backdrop-blur-sm',
                  toneStyles[toast.tone],
                )}
              >
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <div
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                      toneAccentStyles[toast.tone],
                    )}
                  >
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold tracking-tight text-on-surface">
                      {toast.title}
                    </p>
                    {toast.description ? (
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        {toast.description}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    className="rounded-lg p-1.5 text-outline transition-colors hover:bg-surface-container-low hover:text-on-surface"
                    aria-label="Dismiss notification"
                  >
                    <X size={14} />
                  </button>
                </div>
                <motion.div
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{
                    duration: toast.durationMs / 1000,
                    ease: 'linear',
                  }}
                  className={cn(
                    'h-1 origin-left',
                    toast.tone === 'success' && 'bg-emerald-500',
                    toast.tone === 'info' && 'bg-sky-500',
                    toast.tone === 'warning' && 'bg-amber-500',
                    toast.tone === 'danger' && 'bg-red-500',
                  )}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
