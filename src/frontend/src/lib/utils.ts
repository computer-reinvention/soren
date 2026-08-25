import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Agent } from '@/types/agent';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Unified agent badge label used across sidebar, chat messages, and @mention dropdown */
export function getAgentBadgeLabel(agent: Pick<Agent, 'type' | 'role' | 'permanent'>): 'SUP' | 'P-SUP' | 'PERM' | 'WRK' {
  const isSupervisor = agent.type === 'supervisor' || agent.role === 'project-supervisor';
  const isProjectSupervisor = agent.role === 'project-supervisor';
  if (isSupervisor) return isProjectSupervisor ? 'P-SUP' : 'SUP';
  if (agent.permanent) return 'PERM';
  return 'WRK';
}

/** Badge color classes keyed by label */
export function getAgentBadgeColor(label: 'SUP' | 'P-SUP' | 'PERM' | 'WRK'): string {
  switch (label) {
    // P5.8/P6.7: these badges have no bg fill of their own, so the actual
    // background behind the text is whatever the row underneath provides —
    // usually the plain page background, but AgentRow.tsx gives the
    // *currently active* agent's row `bg-accent` (~92% lightness gray in
    // light mode), which is measurably darker than the page background and
    // needs its own (stricter) contrast check. Each shade below was picked
    // to clear 4.5:1 against both the page background and bg-accent, in
    // both themes — a single shade never covers all four combinations,
    // e.g. amber-700 passes page/light (4.81) but not accent/light (4.17).
    case 'P-SUP': return 'border-purple-500/50 text-purple-700 dark:text-purple-400';
    case 'SUP': return 'border-amber-500/50 text-amber-800 dark:text-amber-400';
    case 'PERM': return 'border-teal-500/50 text-teal-800 dark:text-teal-400';
    case 'WRK': return 'border-muted';
  }
}

/** Format a token count as compact string: 842, 12.4k, 1.2M */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** Message prefix → badge config. Returns null if no known prefix found. */
const MESSAGE_PREFIXES = [
  { tag: '[TASK]', label: 'TASK', className: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/30' },
  { tag: '[UPDATE]', label: 'UPDATE', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30' },
  { tag: '[DONE]', label: 'DONE', className: 'bg-green-500/15 text-green-800 dark:text-green-400 border-green-500/30' },
  { tag: '[STATUS]', label: 'STATUS', className: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30' },
  { tag: '[BLOCKED]', label: 'BLOCKED', className: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30' },
  { tag: '[QUESTION]', label: 'QUESTION', className: 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30' },
  { tag: '[PRIORITY]', label: 'PRIORITY', className: 'bg-orange-500/15 text-orange-800 dark:text-orange-400 border-orange-500/30' },
  { tag: '[COMPLETE]', label: 'COMPLETE', className: 'bg-green-500/15 text-green-800 dark:text-green-400 border-green-500/30' },
  { tag: '[REVIEW-REQUEST]', label: 'REVIEW', className: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30' },
  { tag: '[TASK-CANCEL]', label: 'CANCELLED', className: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30' },
  { tag: '[VERIFIED]', label: 'VERIFIED', className: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30' },
  { tag: '[VERIFY-FAILED]', label: 'VERIFY FAILED', className: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30' },
  { tag: '[VERIFY-WARN]', label: 'VERIFY WARN', className: 'bg-yellow-500/15 text-yellow-800 dark:text-yellow-400 border-yellow-500/30' },
  { tag: '[LOG ALERT]', label: 'LOG ALERT', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30' },
  { tag: '[ALERT]', label: 'ALERT', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30' },
  { tag: '[REMINDER]', label: 'REMINDER', className: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30' },
  { tag: '[UI-CHECK]', label: 'UI CHECK', className: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-400 border-cyan-500/30' },
  { tag: '[SYS]', label: 'SYSTEM', className: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30' },
  { tag: '[photo]', label: 'PHOTO', className: 'bg-teal-500/15 text-teal-800 dark:text-teal-400 border-teal-500/30' },
] as const;

const PHOTO_PREFIX_RE = /^\[photo(?::([^\]]+))?\]\s*/;

export function parseMessagePrefix(content: string): { label: string; className: string; rest: string; photoFilename?: string } | null {
  const trimmed = content.trimStart();

  // Check [photo] / [photo:filename] first (dynamic tag)
  const photoMatch = trimmed.match(PHOTO_PREFIX_RE);
  if (photoMatch) {
    const photoEntry = MESSAGE_PREFIXES.find((p) => p.tag === '[photo]')!;
    return {
      label: photoEntry.label,
      className: photoEntry.className,
      rest: trimmed.slice(photoMatch[0].length),
      photoFilename: photoMatch[1] || undefined,
    };
  }

  for (const { tag, label, className } of MESSAGE_PREFIXES) {
    if (trimmed.startsWith(tag)) {
      return { label, className, rest: trimmed.slice(tag.length).trimStart() };
    }
  }
  return null;
}
