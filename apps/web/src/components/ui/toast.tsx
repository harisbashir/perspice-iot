import * as ToastPrimitive from '@radix-ui/react-toast';
import { type ReactNode, createContext, useCallback, useContext, useState } from 'react';
import { cn } from '@/lib/utils';

export interface ToastMessage {
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error';
}

const ToastContext = createContext<(t: ToastMessage) => void>(() => undefined);

/** `const toast = useToast(); toast({ title: 'Saved' })` */
export const useToast = () => useContext(ToastContext);

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<(ToastMessage & { id: number })[]>([]);
  const push = useCallback((t: ToastMessage) => setToasts((all) => [...all, { ...t, id: Date.now() + Math.random() }]), []);
  return (
    <ToastContext.Provider value={push}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            onOpenChange={(open) => !open && setToasts((all) => all.filter((x) => x.id !== t.id))}
            className="flex animate-fade-in gap-3 rounded-2xl bg-surface p-4 shadow-float dark:bg-surface-2"
          >
            {/* The dot carries the outcome next to the words, not instead of them. */}
            <span
              aria-hidden
              className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', t.variant === 'error' ? 'bg-crit-vivid' : t.variant === 'success' ? 'bg-ok-vivid' : 'bg-primary-500')}
            />
            <div className="min-w-0">
              <ToastPrimitive.Title className={cn('text-sm font-semibold', t.variant === 'error' && 'text-crit')}>{t.title}</ToastPrimitive.Title>
              {t.description && <ToastPrimitive.Description className="mt-0.5 text-sm text-fg-muted">{t.description}</ToastPrimitive.Description>}
            </div>
          </ToastPrimitive.Root>
        ))}
        {/* Above the phone tab bar; bottom right on desktop. */}
        <ToastPrimitive.Viewport className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] left-1/2 z-[100] flex w-96 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-col gap-2 lg:bottom-4 lg:left-auto lg:right-4 lg:translate-x-0" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
