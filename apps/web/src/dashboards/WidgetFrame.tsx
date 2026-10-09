import { Component, type ErrorInfo, type ReactNode } from 'react';

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Widget failed', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex h-full items-center justify-center p-2 text-center text-xs text-red-600 dark:text-red-400">
          This widget failed to display.
        </div>
      );
    }
    return this.props.children;
  }
}

/** Card chrome around a widget; a failing widget only breaks its own frame. */
export function WidgetFrame({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section
      aria-label={title || 'Widget'}
      className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 px-3 pt-2">
          <h3 className="truncate text-sm font-medium text-slate-600 dark:text-slate-300">{title}</h3>
          {actions}
        </header>
      )}
      <div className="min-h-0 flex-1 p-3 pt-1">
        <Boundary>{children}</Boundary>
      </div>
    </section>
  );
}
