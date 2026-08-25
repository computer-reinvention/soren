import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SHORTCUT_GROUPS } from '@/lib/shortcuts';

export function ShortcutGroupsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.title}
          </h3>
          <dl className="space-y-1">
            {group.items.map(([keys, desc]) => (
              <div key={keys} className="flex items-center justify-between gap-3">
                <dt>
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/90">
                    {keys}
                  </kbd>
                </dt>
                <dd className="flex-1 text-right font-mono text-[11px] text-muted-foreground">
                  {desc}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">
            keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="sr-only">
            Reference list of available keyboard shortcuts
          </DialogDescription>
        </DialogHeader>
        <ShortcutGroupsGrid />
      </DialogContent>
    </Dialog>
  );
}
