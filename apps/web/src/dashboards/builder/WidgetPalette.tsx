import { type WidgetCategory, type WidgetDefinition, listWidgets } from '@perspice/widgets';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const CATEGORIES: [WidgetCategory, string][] = [
  ['value', 'Values'],
  ['chart', 'Charts'],
  ['table', 'Tables'],
  ['map', 'Maps'],
  ['control', 'Controls'],
  ['other', 'Other'],
];

export function WidgetPalette({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (w: WidgetDefinition) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add widget</DialogTitle>
          <DialogDescription>Choose a widget; you can set its data and options afterwards.</DialogDescription>
        </DialogHeader>
        {CATEGORIES.map(([cat, label]) => {
          const widgets = listWidgets(cat).filter((w) => !w.type.startsWith('test-'));
          if (!widgets.length) return null;
          return (
            <section key={cat} aria-label={label}>
              <h3 className="mb-2 text-xs font-semibold uppercase text-fg-muted">{label}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {widgets.map((w) => (
                  <button
                    key={w.type}
                    type="button"
                    className="flex items-start gap-3 rounded-md border border-line p-3 text-left hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950"
                    onClick={() => {
                      onPick(w);
                      onOpenChange(false);
                    }}
                  >
                    <w.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300" />
                    <span>
                      <span className="block text-sm font-medium">{w.name}</span>
                      <span className="block text-xs text-fg-muted">{w.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
