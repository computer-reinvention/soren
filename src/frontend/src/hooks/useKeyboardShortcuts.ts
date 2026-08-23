import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { routes, useRouteAgentId } from '@/lib/navigation';
import { useAgents } from '@/hooks/useAgents';
import { useProjects } from '@/hooks/useProjects';
import { groupAgentsByProject } from '@/components/sidebar/sidebar-utils';

/**
 * Global keyboard shortcuts (P2.4). Complements the Cmd/Ctrl+1-4 tab
 * shortcuts in CenterTabs and Cmd+K in CommandPalette:
 *
 *   j / k        next / previous agent (sidebar order)
 *   g then o/c/t/e  go to overview / chat / tasks / terminal
 *   /            focus the sidebar filter
 *   ?            toggle the shortcut help overlay
 *   Escape       back to overview (when not typing / no dialog open)
 *
 * Returns help-overlay state for ShortcutHelp.
 */

const SEQUENCE_TIMEOUT_MS = 1000;

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

function anyDialogOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="dialog"]:not([data-state])') !== null;
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const currentAgentId = useRouteAgentId();
  const { data: agentsData } = useAgents();
  const { data: projectsData } = useProjects();
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingPrefix = useRef<{ key: string; at: number } | null>(null);

  // Flat agent order matching the sidebar: per group, supervisor first.
  const orderedAgentIds = useMemo(() => {
    const groups = groupAgentsByProject(agentsData?.agents ?? [], projectsData?.projects ?? []);
    const ids: string[] = [];
    for (const g of groups) {
      if (g.supervisor) ids.push(g.supervisor.id);
      for (const a of g.agents) ids.push(a.id);
    }
    return ids;
  }, [agentsData, projectsData]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Never fight modifiers (except shift for '?'), inputs, or dialogs.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      // '?' toggles help even while a dialog (the help itself) is open.
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (anyDialogOpen()) return;

      // Two-key sequences: g then <key>
      const now = Date.now();
      if (pendingPrefix.current && now - pendingPrefix.current.at < SEQUENCE_TIMEOUT_MS) {
        const prefix = pendingPrefix.current.key;
        pendingPrefix.current = null;
        if (prefix === 'g') {
          const dest: Record<string, string> = {
            o: routes.overview(),
            c: routes.chat(),
            t: routes.tasks(),
            e: routes.terminal(),
          };
          if (dest[e.key]) {
            e.preventDefault();
            navigate(dest[e.key]);
            return;
          }
        }
      }
      if (e.key === 'g') {
        pendingPrefix.current = { key: 'g', at: now };
        return;
      }

      switch (e.key) {
        case 'j':
        case 'k': {
          if (orderedAgentIds.length === 0) return;
          e.preventDefault();
          const idx = currentAgentId ? orderedAgentIds.indexOf(currentAgentId) : -1;
          const delta = e.key === 'j' ? 1 : -1;
          const next =
            idx === -1
              ? e.key === 'j'
                ? 0
                : orderedAgentIds.length - 1
              : (idx + delta + orderedAgentIds.length) % orderedAgentIds.length;
          navigate(routes.agent(orderedAgentIds[next]));
          return;
        }
        case '/': {
          e.preventDefault();
          document.getElementById('sidebar-filter')?.focus();
          return;
        }
        case 'Escape': {
          navigate(routes.overview());
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, currentAgentId, orderedAgentIds]);

  return { helpOpen, setHelpOpen };
}
