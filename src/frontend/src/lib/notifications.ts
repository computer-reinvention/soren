import { useNotificationStore } from '@/stores/notificationStore';
import { routes } from '@/lib/navigation';
import type { Message } from '@/types/message';

/**
 * Browser notifications for away-state monitoring (P3.7, decision D9a).
 * Fires only when: the user enabled them, permission is granted, the tab is
 * hidden, and the message is notify-worthy ([DONE]/[BLOCKED]/[VERIFY-FAILED]/
 * alerts, or anything addressed to the user).
 */

const NOTIFY_PATTERNS = ['[DONE]', '[BLOCKED]', '[VERIFY-FAILED]', 'SYSTEM ALERT', 'SENTRY'];

export function isNotifyWorthy(msg: Message): boolean {
  if (msg.to_agent === 'user') return true;
  const content = msg.content ?? '';
  return NOTIFY_PATTERNS.some((p) => content.includes(p));
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function maybeNotify(msg: Message): void {
  if (!useNotificationStore.getState().enabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return; // user is looking at the dashboard already
  if (msg.from_agent === 'user') return; // never notify about own messages
  if (!isNotifyWorthy(msg)) return;

  const firstLine = (msg.content ?? '').split('\n')[0].slice(0, 140);
  try {
    const n = new Notification(`soren · ${msg.from_agent}`, {
      body: firstLine,
      tag: msg.id, // dedupe re-deliveries
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      window.location.assign(routes.agent(msg.from_agent));
      n.close();
    };
  } catch {
    /* some platforms throw for backgrounded constructors — ignore */
  }
}
