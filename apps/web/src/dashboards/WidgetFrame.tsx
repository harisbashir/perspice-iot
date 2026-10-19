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
        <div role="alert" className="flex h-full items-center justify-center p-2 text-center text-xs text-crit">
          This widget failed to display.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Card chrome around a widget; a failing widget only breaks its own frame. The body is a size
 * container (`@container`), so widgets can adapt to their own width with `@sm:` etc.
 */
export function WidgetFrame({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title || 'Widget'} className="flex h-full flex-col overflow-hidden rounded-xl bg-surface shadow-card">
      {(title || actions) && (
        <header className="flex min-h-9 items-center justify-between gap-2 pl-3.5 pr-1.5 pt-1.5">
          <h3 className="truncate text-[13px] font-semibold text-fg-muted">{title}</h3>
          {actions}
        </header>
      )}
      <div className="@container min-h-0 flex-1 px-3.5 pb-3 pt-1">
        <Boundary>{children}</Boundary>
      </div>
    </section>
  );
}
