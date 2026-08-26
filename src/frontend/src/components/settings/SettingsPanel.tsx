import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Minus, Plus, Monitor, Moon, Sun, Bell, BellOff, LayoutGrid, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/stores/themeStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useTerminalSettingsStore } from '@/stores/terminalSettingsStore';
import { usePrefs, useUpdatePrefs } from '@/hooks/usePrefs';
import { requestNotificationPermission } from '@/lib/notifications';
import { ShortcutGroupsGrid } from '@/components/ShortcutHelp';
import { useIsMobile } from '@/hooks/use-mobile';

const SCROLLBACK_OPTIONS = [5_000, 10_000, 25_000, 50_000] as const;

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground/80">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1.5 font-mono text-xs transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

/**
 * P5.2 — settings panel. A Dialog (not a route) mounted globally in
 * Shell(), matching the existing precedent for app-wide overlays
 * (ShortcutHelp, OnboardingModal, CommandPalette) rather than the
 * routed-page pattern used for primary content like /reliability.
 *
 * Deliberately NOT everything here round-trips through GET/PUT /api/prefs:
 * only `ui_density` does, because it's the one setting worth syncing across
 * browsers/devices. Theme, notifications-enabled, and terminal font size /
 * scrollback stay in their existing zustand+localStorage stores — pure
 * client-display concerns that already work, with no reason to add a
 * network round-trip (see lib/density.ts and
 * stores/terminalSettingsStore.ts's docblocks for the same reasoning).
 * Keyboard shortcuts are shown for reference only — they aren't remappable
 * (see hooks/useKeyboardShortcuts.ts, which hardcodes every binding).
 */
export function SettingsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { theme, setTheme } = useThemeStore();
  const { enabled: notificationsEnabled, setEnabled: setNotificationsEnabled } = useNotificationStore();
  const { desktopFontSize, mobileFontSize, scrollback, increaseFontSize, decreaseFontSize, setScrollback } =
    useTerminalSettingsStore();
  const { data: prefs } = usePrefs();
  const updatePrefs = useUpdatePrefs();
  // "keyboard shortcuts" is dead weight on mobile — there's no physical
  // keyboard to use them with. "terminal" (font size/scrollback) stays
  // visible on both: the terminal itself is fully usable on mobile now
  // (see WebTerminal.tsx), and this is the only place to tune font size
  // there since the panel's own header dropped its inline stepper to make
  // room for the essentials.
  const isMobile = useIsMobile();
  // Font size is tracked per device class (see terminalSettingsStore) —
  // a phone needs to go much smaller than a desktop user ever would to
  // fit a usable number of columns.
  const fontSize = isMobile ? mobileFontSize : desktopFontSize;

  const density = prefs?.ui_density ?? 'comfortable';

  const handleToggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      return;
    }
    const granted = await requestNotificationPermission();
    setNotificationsEnabled(granted);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">settings</DialogTitle>
          <DialogDescription className="sr-only">
            Appearance, notifications, terminal, and keyboard shortcut preferences
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <SettingsSection title="appearance">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-foreground/80">theme</span>
              <div className="flex gap-1 rounded-md border border-border/60 p-0.5">
                <SegmentButton active={theme === 'light'} onClick={() => setTheme('light')} title="Light">
                  <Sun className="h-3.5 w-3.5" />
                </SegmentButton>
                <SegmentButton active={theme === 'dark'} onClick={() => setTheme('dark')} title="Dark">
                  <Moon className="h-3.5 w-3.5" />
                </SegmentButton>
                <SegmentButton active={theme === 'system'} onClick={() => setTheme('system')} title="Follow system">
                  <Monitor className="h-3.5 w-3.5" />
                </SegmentButton>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-foreground/80">density</span>
              <div className="flex gap-1 rounded-md border border-border/60 p-0.5">
                <SegmentButton
                  active={density === 'comfortable'}
                  onClick={() => updatePrefs.mutate({ ui_density: 'comfortable' })}
                  title="Comfortable"
                >
                  <Rows3 className="h-3.5 w-3.5" />
                  comfortable
                </SegmentButton>
                <SegmentButton
                  active={density === 'compact'}
                  onClick={() => updatePrefs.mutate({ ui_density: 'compact' })}
                  title="Compact"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  compact
                </SegmentButton>
              </div>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground dark:text-muted-foreground/80">
              compact tightens the sidebar agent list, activity feed, and task cards. synced across browsers.
            </p>
          </SettingsSection>

          <Separator />

          <SettingsSection title="notifications">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-foreground/80">browser notifications</span>
              <SegmentButton
                active={notificationsEnabled}
                onClick={handleToggleNotifications}
                title={notificationsEnabled ? 'Disable' : 'Enable'}
              >
                {notificationsEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                {notificationsEnabled ? 'on' : 'off'}
              </SegmentButton>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground dark:text-muted-foreground/80">
              fires for [DONE] / [BLOCKED] / [VERIFY-FAILED] / alerts, only while this tab is hidden.
            </p>
          </SettingsSection>

          <Separator />

          {/* Terminal is available (and genuinely used) on mobile now —
              font size in particular matters there, since the panel's own
              inline stepper was dropped to make room in its compact
              header (see WebTerminal.tsx). This is the only place to
              adjust it on a phone. */}
          <SettingsSection title="terminal">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-foreground/80">font size</span>
              <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5">
                <button
                  type="button"
                  onClick={() => decreaseFontSize(isMobile)}
                  title="Decrease font size"
                  className="rounded p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-8 text-center font-mono text-xs tabular-nums text-foreground/80">{fontSize}px</span>
                <button
                  type="button"
                  onClick={() => increaseFontSize(isMobile)}
                  title="Increase font size"
                  className="rounded p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-foreground/80">scrollback</span>
              <div className="flex gap-1 rounded-md border border-border/60 p-0.5">
                {SCROLLBACK_OPTIONS.map((n) => (
                  <SegmentButton key={n} active={scrollback === n} onClick={() => setScrollback(n)}>
                    {n >= 1000 ? `${n / 1000}k` : n}
                  </SegmentButton>
                ))}
              </div>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground dark:text-muted-foreground/80">
              scrollback is read once when a terminal opens — changes apply the next time you open one, not to an
              already-running session.
            </p>
          </SettingsSection>

          {!isMobile && (
            <>
              <Separator />

              <SettingsSection title="keyboard shortcuts">
                <ShortcutGroupsGrid />
              </SettingsSection>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
