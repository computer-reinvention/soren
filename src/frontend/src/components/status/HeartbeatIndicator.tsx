import { useEffect, useState, useCallback } from 'react';
import { Heart, HeartCrack, Clock, Inbox, Users, ListTodo, Monitor, Shield, Bell, GitBranch, Activity, Settings, Check, AlertTriangle } from 'lucide-react';
import { useHeartbeatStore } from '../../stores/heartbeatStore';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Button } from '../ui/button';

const SECTION_ICONS: Record<string, typeof Inbox> = {
  mailbox: Inbox,
  workers: Users,
  backlog: ListTodo,
  supervisors: Monitor,
  watchdog: Shield,
  reminders: Bell,
  git: GitBranch,
  health: Activity,
};

type HeartStatus = 'idle' | 'clear' | 'active' | 'alert';

interface HeartbeatPrefs {
  heartbeat_warn_threshold: number;
  heartbeat_nudge_interval: number;
  heartbeat_max_nudges: number;
  heartbeat_observe_timeout: number;
}

const PREF_LABELS: Record<keyof HeartbeatPrefs, { label: string; unit: string; tooltip: string }> = {
  heartbeat_warn_threshold: { label: 'Idle warn', unit: 's', tooltip: 'Seconds of supervisor idle time before the first productivity nudge is sent' },
  heartbeat_nudge_interval: { label: 'Nudge cooldown', unit: 's', tooltip: 'Minimum seconds between consecutive nudge messages' },
  heartbeat_max_nudges: { label: 'Max nudges', unit: '', tooltip: 'Maximum nudge attempts before escalating to sentry recovery' },
  heartbeat_observe_timeout: { label: 'Observe timeout', unit: 's', tooltip: 'Seconds of frozen terminal output before declaring supervisor stuck' },
};

export function HeartbeatIndicator() {
  const { latest, setLatest } = useHeartbeatStore();
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null);
  const [supervisorIdleAgo, setSupervisorIdleAgo] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<HeartbeatPrefs | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [editKey, setEditKey] = useState<keyof HeartbeatPrefs | null>(null);
  const [editValue, setEditValue] = useState('');

  // Fetch initial heartbeat on mount (via api client: auth + 401 handling)
  useEffect(() => {
    api
      .getHeartbeat()
      .then((data) => {
        if (data.timestamp) {
          setLatest({
            ...data,
            supervisor_idle_seconds: data.supervisor_idle_seconds ?? null,
            supervisor_state: data.supervisor_state ?? null,
          });
        }
      })
      .catch(() => {});
  }, [setLatest]);

  // Fetch prefs when config section is shown
  useEffect(() => {
    if (!showConfig) return;
    api
      .getPrefs()
      .then((p) => setPrefs(p as unknown as HeartbeatPrefs))
      .catch(() => {});
  }, [showConfig]);

  // Update "X seconds ago" every second — counts from when the client
  // received the heartbeat, not the server's wall-clock timestamp (which
  // is always near-current because monitor.sh re-POSTs every ~5 s).
  // Also tick supervisor idle time: when a new heartbeat arrives with
  // supervisor_idle_seconds = N, start ticking from N using client time.
  useEffect(() => {
    if (!latest) return;
    const update = () => {
      const clientElapsed = Math.floor((Date.now() - latest.clientReceivedAt) / 1000);
      setSecondsAgo(Math.max(0, clientElapsed));
      if (latest.supervisor_idle_seconds != null) {
        setSupervisorIdleAgo(Math.max(0, latest.supervisor_idle_seconds + clientElapsed));
      } else {
        setSupervisorIdleAgo(null);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [latest?.clientReceivedAt, latest?.supervisor_idle_seconds]);

  const getStatus = useCallback((): HeartStatus => {
    if (!latest) return 'idle';
    if (latest.all_clear) return 'clear';
    const pri = latest.highest_priority?.toLowerCase() || '';
    if (pri.includes('failed') || pri.includes('health') || pri.includes('stuck') || pri.includes('down')) {
      return 'alert';
    }
    return 'active';
  }, [latest]);

  const status = getStatus();

  // Heart is always red — it's a heart. Alert states use HeartCrack icon instead.
  const HeartIcon = status === 'alert' ? HeartCrack : Heart;

  const formatAgo = (s: number | null) => {
    if (s === null) return 'No data';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  };

  const formatIdleDuration = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  const savePref = async (key: keyof HeartbeatPrefs) => {
    const num = parseInt(editValue, 10);
    if (isNaN(num) || num < 0) return;
    try {
      const updated = await api.updatePrefs({ [key]: num });
      setPrefs(updated as unknown as HeartbeatPrefs);
    } catch { /* ignore */ }
    setEditKey(null);
  };

  const sectionEntries = latest
    ? Object.entries(latest.sections).filter(([, v]) => v && v.length > 0)
    : [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 relative" title="System heartbeat">
          <HeartIcon
            className={cn(
              'h-4 w-4 text-red-500 fill-red-500 transition-colors',
              status === 'alert' ? 'animate-pulse' : 'animate-heartbeat',
            )}
          />
          {status === 'active' && (
            <span className="absolute top-0.5 right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-amber-400 border border-background" />
          )}
          {status === 'alert' && (
            <span className="absolute top-0 right-0 flex h-3 w-3 items-center justify-center rounded-full bg-red-600 border border-background">
              <AlertTriangle className="h-2 w-2 text-white" strokeWidth={3} />
            </span>
          )}
          <span className="sr-only">System heartbeat</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <HeartIcon className="h-3.5 w-3.5 text-red-500 fill-red-500" />
              {latest?.supervisor_state ? (
                <span>
                  Supervisor: {latest.supervisor_state}
                  {supervisorIdleAgo != null && (
                    <span className="text-muted-foreground font-normal"> (idle {formatIdleDuration(supervisorIdleAgo)})</span>
                  )}
                </span>
              ) : (
                'Heartbeat'
              )}
            </span>
          </div>
          <span className="text-[10px] font-normal text-muted-foreground flex items-center gap-1 ml-5">
            <Clock className="h-2.5 w-2.5" />
            Last scan {formatAgo(secondsAgo)}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {!latest && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            Waiting for first heartbeat...
          </div>
        )}

        {latest?.all_clear && sectionEntries.length === 0 && (
          <div className="px-3 py-4 flex items-center justify-center gap-2 text-xs text-emerald-500 dark:text-emerald-400">
            <Heart className="h-4 w-4 fill-red-500 text-red-500 animate-heartbeat" />
            <span className="text-emerald-500 dark:text-emerald-400">All clear — system healthy</span>
          </div>
        )}

        {sectionEntries.length > 0 && (
          <div className="px-1 py-1 space-y-0.5">
            {sectionEntries.map(([key, value]) => {
              const Icon = SECTION_ICONS[key] || Activity;
              return (
                <div
                  key={key}
                  className="flex items-start gap-2.5 px-2 py-1.5 rounded-md text-xs hover:bg-accent/50"
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground capitalize">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <p className="text-muted-foreground mt-0.5 leading-snug">{value}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {latest?.highest_priority && (
          <>
            <DropdownMenuSeparator />
            <div className="px-3 py-2 text-xs">
              <span className="font-semibold text-orange-600 dark:text-orange-400">Next action: </span>
              <span className="text-muted-foreground">{latest.highest_priority}</span>
            </div>
          </>
        )}

        {/* System actions */}
        <DropdownMenuSeparator />
        <button
          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          onClick={(e) => { e.preventDefault(); setShowConfig((v) => !v); }}
        >
          <Settings className="h-3 w-3" />
          {showConfig ? 'Hide config' : 'Heartbeat config'}
        </button>

        {showConfig && prefs && (
          <div className="px-3 pb-2 space-y-1.5">
            {(Object.keys(PREF_LABELS) as (keyof HeartbeatPrefs)[]).map((key) => {
              const { label, unit, tooltip } = PREF_LABELS[key];
              const isEditing = editKey === key;
              return (
                <div key={key} className="flex items-center justify-between text-[11px]">
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-muted-foreground">{label}</span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-[200px] text-xs">
                        {tooltip}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {isEditing ? (
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        className="w-16 h-5 px-1 text-[11px] rounded border bg-background text-foreground text-right font-mono"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') savePref(key); if (e.key === 'Escape') setEditKey(null); }}
                        autoFocus
                      />
                      <span className="text-muted-foreground">{unit}</span>
                      <button
                        className="p-0.5 hover:text-emerald-500 transition-colors"
                        onClick={(e) => { e.preventDefault(); savePref(key); }}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </span>
                  ) : (
                    <button
                      className="font-mono text-foreground hover:text-blue-500 transition-colors cursor-pointer"
                      onClick={(e) => { e.preventDefault(); setEditKey(key); setEditValue(String(prefs[key])); }}
                    >
                      {prefs[key]}{unit}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
