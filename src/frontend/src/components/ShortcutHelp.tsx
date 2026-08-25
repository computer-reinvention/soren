import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Exported so the Settings panel (P5.2) can embed the same reference list
// instead of maintaining a second copy — shortcuts aren't remappable (see
// hooks/useKeyboardShortcuts.ts, which hardcodes every binding), so this is
// intentionally read-only in both places.
export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'navigate',
    items: [
      ['⌘1 – ⌘4', 'overview / chat / terminal / tasks'],
      ['g then o·c·t·e', 'overview / chat / tasks / terminal'],
      ['j / k', 'next / previous agent'],
      ['esc', 'back to overview'],
    ],
  },
  {
    title: 'find',
    items: [
      ['⌘K', 'command palette'],
      ['/', 'focus sidebar filter'],
    ],
  },
  {
    title: 'chat & terminal',
    items: [
      ['⌘↵', 'send message'],
      ['ctrl+`', 'toggle terminal'],
    ],
  },
  {
    title: 'help',
    items: [['?', 'toggle this overlay']],
  },
];

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
        </DialogHeader>
        <ShortcutGroupsGrid />
      </DialogContent>
    </Dialog>
  );
}
