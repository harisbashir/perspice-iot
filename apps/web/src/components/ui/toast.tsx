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
            className={cn(
              'rounded-md border p-4 shadow-lg',
              t.variant === 'error'
                ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100'
                : t.variant === 'success'
                  ? 'border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
            )}
          >
            <ToastPrimitive.Title className="text-sm font-semibold">{t.title}</ToastPrimitive.Title>
            {t.description && <ToastPrimitive.Description className="mt-1 text-sm">{t.description}</ToastPrimitive.Description>}
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
